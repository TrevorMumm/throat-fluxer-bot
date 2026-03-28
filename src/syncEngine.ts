import type { Client } from "@discordjs/core";
import type { REST } from "@discordjs/rest";
import { INSTANCE_ID, SYNC_POLL_INTERVAL_MS } from "./config.js";
import {
  checkSyncStop,
  clearSyncStop,
  createSyncEvent,
  deleteSyncChannelMap,
  findAllChannelMapsBySource,
  findChannelMapInConfig,
  getSyncConfig,
  getUnprocessedEvents,
  markEventProcessed,
  stopAllSyncs,
} from "./data/sync.js";

let intervalId: ReturnType<typeof setInterval> | null = null;
let stopped = false;

// ── Event capture (called from handlers.ts on MessageCreate) ────────

export async function captureSyncEvent(
  channelId: string,
  messageId: string,
  authorName: string,
  authorAvatar: string | undefined,
  content: string,
  attachments: { url: string; filename: string; content_type?: string }[],
  embeds: unknown[],
): Promise<void> {
  if (!INSTANCE_ID || stopped) return;

  // Find ALL channel maps where this channel is on our instance's side.
  // A channel can belong to multiple pairs (e.g. A-B and A-C).
  const mappings = await findAllChannelMapsBySource(channelId, INSTANCE_ID);
  if (mappings.length === 0) return;

  for (const mapping of mappings) {
    await createSyncEvent({
      syncConfigId: mapping.syncConfigId,
      sourceInstance: INSTANCE_ID,
      originInstance: INSTANCE_ID,
      eventType: "message_create",
      channelId,
      messageId,
      authorName,
      authorAvatar,
      content: content || undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
      embeds:
        embeds.length > 0
          ? (embeds as { [key: string]: string | number | boolean | null }[])
          : undefined,
    });
  }
}

// ── Channel delete capture (called from handlers.ts on ChannelDelete) ──

export async function captureChannelDeleteEvent(
  channelId: string,
): Promise<void> {
  if (!INSTANCE_ID || stopped) return;

  const mappings = await findAllChannelMapsBySource(channelId, INSTANCE_ID);
  if (mappings.length === 0) return;

  for (const mapping of mappings) {
    await createSyncEvent({
      syncConfigId: mapping.syncConfigId,
      sourceInstance: INSTANCE_ID,
      originInstance: INSTANCE_ID,
      eventType: "channel_delete",
      channelId,
    });
  }

  console.log(
    `[sync] Captured channel_delete for channel ${channelId} (${mappings.length} pair(s))`,
  );
}

// ── Event processing (polls the database) ───────────────────────────

async function processEvents(client: Client): Promise<void> {
  if (!INSTANCE_ID || stopped) return;

  try {
    // Check for emergency stop
    const shouldStop = await checkSyncStop();
    if (shouldStop) {
      console.log("[sync] Emergency stop triggered — halting sync engine");
      await stopAllSyncs();
      await clearSyncStop();
      stopped = true;
      stopSyncEngine();
      return;
    }

    const events = await getUnprocessedEvents(INSTANCE_ID);
    if (events.length === 0) return;

    for (const event of events) {
      if (stopped) break;

      try {
        await processOneEvent(client, event);
        await markEventProcessed(event.id);
      } catch (error) {
        console.error(`[sync] Failed to process event ${event.id}:`, error);
        await markEventProcessed(event.id);
      }
    }
  } catch (error) {
    console.error("[sync] Error in event processing loop:", error);
  }
}

async function processOneEvent(
  client: Client,
  event: {
    id: number;
    syncConfigId: string;
    sourceInstance: string;
    originInstance: string | null;
    eventType: string;
    channelId: string;
    messageId: string | null;
    authorName: string | null;
    authorAvatar: string | null;
    content: string | null;
    attachments: unknown;
    embeds: unknown;
  },
): Promise<void> {
  // Loop detection: if this event originally came from us, skip it
  if (event.originInstance === INSTANCE_ID) return;

  // Get the sync config to determine which instances are paired
  const config = await getSyncConfig(event.syncConfigId);
  if (!config) return;

  // Determine which side of the pair is the source and which is the target
  const isSourceSideA = config.instanceA === event.sourceInstance;
  const targetInstance = isSourceSideA ? config.instanceB : config.instanceA;

  // Only process if WE are the target instance
  if (targetInstance !== INSTANCE_ID) return;

  if (event.eventType === "channel_delete") {
    await processChannelDelete(client, event, isSourceSideA);
    return;
  }

  if (event.eventType !== "message_create") return;

  await processMessageCreate(client, event, isSourceSideA);
}

async function processChannelDelete(
  client: Client,
  event: {
    id: number;
    syncConfigId: string;
    channelId: string;
    sourceInstance: string;
  },
  isSourceSideA: boolean,
): Promise<void> {
  const mapping = await findChannelMapInConfig(
    event.channelId,
    event.syncConfigId,
    event.sourceInstance,
  );
  if (!mapping) return;

  const targetChannelId = isSourceSideA
    ? mapping.channelIdB
    : mapping.channelIdA;

  // Delete the channel on our local instance
  try {
    await client.api.channels.delete(targetChannelId);
    console.log(
      `[sync] Deleted paired channel ${targetChannelId} (source channel ${event.channelId} was deleted)`,
    );
  } catch (error) {
    console.error(
      `[sync] Failed to delete paired channel ${targetChannelId}:`,
      error,
    );
  }

  // Remove the channel map entry
  try {
    await deleteSyncChannelMap(mapping.id);
  } catch (error) {
    console.error(`[sync] Failed to remove channel map ${mapping.id}:`, error);
  }
}

async function processMessageCreate(
  client: Client,
  event: {
    id: number;
    syncConfigId: string;
    sourceInstance: string;
    channelId: string;
    authorName: string | null;
    authorAvatar: string | null;
    content: string | null;
    attachments: unknown;
    embeds: unknown;
  },
  isSourceSideA: boolean,
): Promise<void> {
  // Find the channel mapping within this specific config
  const mapping = await findChannelMapInConfig(
    event.channelId,
    event.syncConfigId,
    event.sourceInstance,
  );
  if (!mapping) return;

  // Determine target channel and webhook
  const targetChannelId = isSourceSideA
    ? mapping.channelIdB
    : mapping.channelIdA;
  const webhookId = isSourceSideA ? mapping.webhookIdB : mapping.webhookIdA;
  const webhookToken = isSourceSideA
    ? mapping.webhookTokenB
    : mapping.webhookTokenA;

  // Build the message payload
  const body: Record<string, unknown> = {};
  if (event.content) body.content = event.content;
  if (event.authorName) body.username = event.authorName;
  if (event.authorAvatar) body.avatar_url = event.authorAvatar;
  if (event.embeds) body.embeds = event.embeds;

  // Handle attachments
  const attachments = event.attachments as
    | { url: string; filename: string; content_type?: string }[]
    | null;

  if (attachments && attachments.length > 0 && !body.content) {
    body.content = "";
  }

  if (attachments && attachments.length > 0) {
    const urls = attachments.map((a) => a.url).join("\n");
    body.content = body.content ? `${body.content}\n${urls}` : urls;
  }

  if (!body.content && !body.embeds) return;

  // Try webhook first (preserves author), fall back to regular message
  if (webhookId && webhookToken) {
    try {
      await executeWebhook(client, webhookId, webhookToken, body);
      return;
    } catch (error) {
      console.error(
        `[sync] Webhook failed for event ${event.id}, falling back:`,
        error,
      );
    }
  }

  // Fallback: post as bot with author attribution
  const authorDisplay = event.authorName
    ? `**${event.authorName}**`
    : "Unknown";
  const fallbackContent = `${authorDisplay}: ${body.content || ""}`;

  try {
    // Target is always our local instance (we only process events targeted at us)
    await client.api.channels.createMessage(targetChannelId, {
      content: fallbackContent,
      allowed_mentions: { parse: [] },
    });
  } catch (error) {
    console.error(
      `[sync] Fallback message send failed for event ${event.id}:`,
      error,
    );
  }
}

async function executeWebhook(
  client: Client,
  webhookId: string,
  webhookToken: string,
  body: Record<string, unknown>,
): Promise<void> {
  // Target is always our local instance, so use our own REST client
  const rest = (client as unknown as { rest: REST }).rest;
  await rest.post(`/webhooks/${webhookId}/${webhookToken}`, { body });
}

// ── Engine lifecycle ────────────────────────────────────────────────

export function startSyncEngine(client: Client): void {
  if (!INSTANCE_ID) {
    console.log("[sync] INSTANCE_ID not set — sync engine disabled");
    return;
  }
  if (intervalId) return;

  stopped = false;
  console.log(
    `[sync] Engine started (instance=${INSTANCE_ID}, poll=${SYNC_POLL_INTERVAL_MS}ms)`,
  );
  intervalId = setInterval(() => processEvents(client), SYNC_POLL_INTERVAL_MS);
}

export function stopSyncEngine(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[sync] Engine stopped");
  }
}

export function isSyncEngineStopped(): boolean {
  return stopped;
}

export function resumeSyncEngine(client: Client): void {
  stopped = false;
  startSyncEngine(client);
}

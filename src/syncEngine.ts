import type { Client } from "@discordjs/core";
import type { REST } from "@discordjs/rest";
import { INSTANCE_ID, SYNC_POLL_INTERVAL_MS } from "./config.js";
import {
  checkSyncStop,
  clearSyncStop,
  createSyncEvent,
  findChannelMapBySource,
  getUnprocessedEvents,
  markEventProcessed,
  stopAllSyncs,
} from "./data/sync.js";
import { getPeerRest } from "./peerClient.js";

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

  const mapping = await findChannelMapBySource(channelId, INSTANCE_ID);
  if (!mapping) return;

  await createSyncEvent({
    syncConfigId: mapping.syncConfigId,
    sourceInstance: INSTANCE_ID,
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

    const peer = getPeerRest();

    for (const event of events) {
      if (stopped) break;

      try {
        await processOneEvent(client, peer, event);
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
  peer: REST | null,
  event: {
    id: number;
    syncConfigId: string;
    sourceInstance: string;
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
  if (event.eventType !== "message_create") return;

  // Find the channel mapping to know where to relay
  const sourceInstance = event.sourceInstance;
  const mapping = await findChannelMapBySource(event.channelId, sourceInstance);
  if (!mapping) return;

  // Determine target channel and webhook
  const targetIsA = sourceInstance === "B";
  const targetChannelId = targetIsA ? mapping.channelIdA : mapping.channelIdB;
  const webhookId = targetIsA ? mapping.webhookIdA : mapping.webhookIdB;
  const webhookToken = targetIsA
    ? mapping.webhookTokenA
    : mapping.webhookTokenB;

  // Build the message payload
  const body: Record<string, unknown> = {};
  if (event.content) body.content = event.content;
  if (event.authorName) body.username = event.authorName;
  if (event.authorAvatar) body.avatar_url = event.authorAvatar;
  if (event.embeds) body.embeds = event.embeds;

  // Handle attachments — download from source, include URLs for now
  // Fluxer webhooks should handle external URLs in content
  const attachments = event.attachments as
    | { url: string; filename: string; content_type?: string }[]
    | null;

  if (attachments && attachments.length > 0 && !body.content) {
    body.content = "";
  }

  // Append attachment URLs to content if we can't upload via webhook
  if (attachments && attachments.length > 0) {
    const urls = attachments.map((a) => a.url).join("\n");
    body.content = body.content ? `${body.content}\n${urls}` : urls;
  }

  if (!body.content && !body.embeds) return;

  // Try webhook first (preserves author), fall back to regular message
  if (webhookId && webhookToken) {
    try {
      await executeWebhook(
        client,
        peer,
        targetIsA,
        webhookId,
        webhookToken,
        body,
      );
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
    if (targetIsA && INSTANCE_ID === "A") {
      await client.api.channels.createMessage(targetChannelId, {
        content: fallbackContent,
        allowed_mentions: { parse: [] },
      });
    } else if (!targetIsA && INSTANCE_ID === "B") {
      await client.api.channels.createMessage(targetChannelId, {
        content: fallbackContent,
        allowed_mentions: { parse: [] },
      });
    } else if (peer) {
      await peer.post(`/channels/${targetChannelId}/messages`, {
        body: { content: fallbackContent, allowed_mentions: { parse: [] } },
      });
    }
  } catch (error) {
    console.error(
      `[sync] Fallback message send failed for event ${event.id}:`,
      error,
    );
  }
}

async function executeWebhook(
  client: Client,
  peer: REST | null,
  targetIsLocal: boolean,
  webhookId: string,
  webhookToken: string,
  body: Record<string, unknown>,
): Promise<void> {
  // The webhook lives on the target instance
  if (targetIsLocal && INSTANCE_ID === (targetIsLocal ? "A" : "B")) {
    // Target is our local instance — use our REST client
    // discord.js core doesn't have a direct webhook execute, use raw REST
    const rest = (client as unknown as { rest: REST }).rest;
    await rest.post(`/webhooks/${webhookId}/${webhookToken}`, { body });
  } else if (peer) {
    await peer.post(`/webhooks/${webhookId}/${webhookToken}`, { body });
  }
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

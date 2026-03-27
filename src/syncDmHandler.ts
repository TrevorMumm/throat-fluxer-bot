import { API_BASE_URL, INSTANCE_ID, PEER_API_BASE_URL } from "./config.js";
import {
  createSyncChannelMap,
  createSyncConfig,
  updateSyncConfigStatus,
} from "./data/sync.js";
import { getPeerRest } from "./peerClient.js";
import {
  deleteSyncSession,
  getSyncSession,
  type SyncGuildInfo,
  updateSyncSession,
} from "./syncSession.js";
import type { BotClient, MessageCreatePayload } from "./types/command.js";

type Channel = { id: string; name: string; type: number; position?: number };
type Webhook = { id: string; token: string };

const labelA = INSTANCE_ID === "A" ? API_BASE_URL : PEER_API_BASE_URL;
const labelB = INSTANCE_ID === "A" ? PEER_API_BASE_URL : API_BASE_URL;

async function fetchChannelsForGuild(
  client: BotClient,
  guildId: string,
  instance: string,
): Promise<Channel[]> {
  const isLocal =
    (INSTANCE_ID === "A" && instance === "A") ||
    (INSTANCE_ID === "B" && instance === "B");
  if (isLocal) {
    return (await client.api.guilds.getChannels(
      guildId,
    )) as unknown as Channel[];
  }
  const peer = getPeerRest();
  if (!peer) throw new Error("Peer API not configured");
  return (await peer.get(`/guilds/${guildId}/channels`)) as Channel[];
}

async function createWebhookOnPeer(channelId: string): Promise<Webhook | null> {
  const peer = getPeerRest();
  if (!peer) return null;
  try {
    const wh = (await peer.post(`/channels/${channelId}/webhooks`, {
      body: { name: "Sync Bridge" },
    })) as Webhook;
    return wh;
  } catch (error) {
    console.error(
      `[sync] Failed to create webhook on peer channel ${channelId}:`,
      error,
    );
    return null;
  }
}

async function createWebhookOnLocal(
  client: BotClient,
  channelId: string,
): Promise<Webhook | null> {
  try {
    const wh = (await client.api.channels.createWebhook(channelId, {
      name: "Sync Bridge",
    })) as unknown as Webhook;
    return wh;
  } catch (error) {
    console.error(
      `[sync] Failed to create local webhook on channel ${channelId}:`,
      error,
    );
    return null;
  }
}

export async function handleSyncDM(
  client: BotClient,
  message: MessageCreatePayload,
): Promise<void> {
  const userId = message.author?.id;
  if (!userId) return;

  const session = getSyncSession(userId);
  if (!session) return;

  const text = message.content.trim();
  const channelId = message.channel_id;
  const lower = text.toLowerCase();

  if (lower === "cancel") {
    deleteSyncSession(userId);
    await client.api.channels.createMessage(channelId, {
      content: "Sync setup cancelled.",
    });
    return;
  }

  switch (session.state) {
    // ── Pick guild on Instance A ──
    case "awaiting_guild_a": {
      const guildsA = session.guildsA ?? [];
      const idx = Number.parseInt(text, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= guildsA.length) {
        await client.api.channels.createMessage(channelId, {
          content:
            "Invalid selection. Type the number of the server, or **cancel** to abort.",
        });
        return;
      }

      const selectedGuild = guildsA[idx];

      // Fetch channel details for the selected guild
      let channels: Channel[];
      try {
        channels = await fetchChannelsForGuild(client, selectedGuild.id, "A");
      } catch (error) {
        await client.api.channels.createMessage(channelId, {
          content: `Failed to fetch channels: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        return;
      }

      const guildInfo: SyncGuildInfo = {
        id: selectedGuild.id,
        name: selectedGuild.name,
        textChannelCount: channels.filter((c) => c.type === 0).length,
        voiceChannelCount: channels.filter((c) => c.type === 2).length,
      };

      updateSyncSession(userId, {
        guildInfoA: guildInfo,
        state: "awaiting_guild_b",
      });

      // Now present Instance B guilds
      const guildsB = session.guildsB ?? [];
      const listB = guildsB.map((g, i) => `**${i + 1}.** ${g.name}`).join("\n");

      await client.api.channels.createMessage(channelId, {
        content:
          `Selected **${selectedGuild.name}** on Instance A.\n\n` +
          `**Instance B** — ${labelB}\n` +
          `The bot has access to ${guildsB.length} server(s):\n\n` +
          `${listB}\n\n` +
          `Which server on **Instance B** should be synced?\n` +
          `Type the number, or **cancel** to abort.`,
      });
      break;
    }

    // ── Pick guild on Instance B ──
    case "awaiting_guild_b": {
      const guildsB = session.guildsB ?? [];
      const idx = Number.parseInt(text, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= guildsB.length) {
        await client.api.channels.createMessage(channelId, {
          content:
            "Invalid selection. Type the number of the server, or **cancel** to abort.",
        });
        return;
      }

      const selectedGuild = guildsB[idx];

      let channels: Channel[];
      try {
        channels = await fetchChannelsForGuild(client, selectedGuild.id, "B");
      } catch (error) {
        await client.api.channels.createMessage(channelId, {
          content: `Failed to fetch channels: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        return;
      }

      const guildInfo: SyncGuildInfo = {
        id: selectedGuild.id,
        name: selectedGuild.name,
        textChannelCount: channels.filter((c) => c.type === 0).length,
        voiceChannelCount: channels.filter((c) => c.type === 2).length,
      };

      updateSyncSession(userId, {
        guildInfoB: guildInfo,
        state: "awaiting_master",
      });

      const infoA = session.guildInfoA as SyncGuildInfo;

      await client.api.channels.createMessage(channelId, {
        content:
          `Selected **${selectedGuild.name}** on Instance B.\n\n` +
          `**Summary**\n` +
          `━━━━━━━━━━━━━━━━━━━━\n\n` +
          `**Instance A** — ${labelA}\n` +
          `  Server: **${infoA.name}**\n` +
          `  • ${infoA.textChannelCount} text channels\n` +
          `  • ${infoA.voiceChannelCount} voice channels\n\n` +
          `**Instance B** — ${labelB}\n` +
          `  Server: **${guildInfo.name}**\n` +
          `  • ${guildInfo.textChannelCount} text channels\n` +
          `  • ${guildInfo.voiceChannelCount} voice channels\n\n` +
          `Which instance should be the **MASTER** (initial source of truth)?\n` +
          `The master's channels and structure will be mirrored to the other instance.\n\n` +
          `Type **A** or **B**, or **cancel** to abort.`,
      });
      break;
    }

    // ── Pick master instance ──
    case "awaiting_master": {
      if (lower !== "a" && lower !== "b") {
        await client.api.channels.createMessage(channelId, {
          content:
            "Please type **A** or **B** to select the master instance, or **cancel** to cancel.",
        });
        return;
      }

      const master = lower.toUpperCase();
      updateSyncSession(userId, { masterInstance: master, state: "confirm_1" });

      const infoA = session.guildInfoA as SyncGuildInfo;
      const infoB = session.guildInfoB as SyncGuildInfo;
      const masterInfo = master === "A" ? infoA : infoB;
      const slaveInfo = master === "A" ? infoB : infoA;
      const masterLabel =
        master === "A" ? `Instance A (${labelA})` : `Instance B (${labelB})`;
      const slaveLabel =
        master === "A" ? `Instance B (${labelB})` : `Instance A (${labelA})`;

      await client.api.channels.createMessage(channelId, {
        content:
          `**Sync Plan**\n` +
          `━━━━━━━━━━━━━━━━━━━━\n` +
          `**Master:** ${masterLabel}\n` +
          `  Server: **${masterInfo.name}** (${masterInfo.textChannelCount} text, ${masterInfo.voiceChannelCount} voice)\n\n` +
          `**Target:** ${slaveLabel}\n` +
          `  Server: **${slaveInfo.name}** (${slaveInfo.textChannelCount} text, ${slaveInfo.voiceChannelCount} voice)\n\n` +
          `Channels from the master will be created on the target if they don't exist.\n` +
          `Existing channels will be paired by name.\n` +
          `Webhooks will be created per channel to preserve author names/avatars.\n` +
          `After initial mirror, all future changes sync both ways.\n\n` +
          `⚠️ **WARNING 1/3:** This will modify the target instance to mirror the master.\n` +
          `Existing data on the target will not be deleted, but duplicates may occur.\n` +
          `Type **yes** to continue or **cancel** to abort.`,
      });
      break;
    }

    // ── Confirmation 1 ──
    case "confirm_1": {
      if (lower !== "yes" && lower !== "y") {
        if (lower === "no" || lower === "n") {
          deleteSyncSession(userId);
          await client.api.channels.createMessage(channelId, {
            content: "Sync setup cancelled.",
          });
          return;
        }
        await client.api.channels.createMessage(channelId, {
          content: "Type **yes** to continue or **cancel** to abort.",
        });
        return;
      }

      updateSyncSession(userId, { state: "confirm_2" });
      await client.api.channels.createMessage(channelId, {
        content:
          `⚠️ **WARNING 2/3:** This process may take time depending on message volume.\n` +
          `Both servers will be actively modified during sync.\n` +
          `Type **yes** to continue or **cancel** to abort.`,
      });
      break;
    }

    // ── Confirmation 2 ──
    case "confirm_2": {
      if (lower !== "yes" && lower !== "y") {
        if (lower === "no" || lower === "n") {
          deleteSyncSession(userId);
          await client.api.channels.createMessage(channelId, {
            content: "Sync setup cancelled.",
          });
          return;
        }
        await client.api.channels.createMessage(channelId, {
          content: "Type **yes** to continue or **cancel** to abort.",
        });
        return;
      }

      updateSyncSession(userId, { state: "confirm_3" });
      await client.api.channels.createMessage(channelId, {
        content:
          `⚠️ **FINAL WARNING (3/3):** This action cannot be easily undone.\n` +
          `Type **CONFIRM SYNC** to begin execution, or **cancel** to abort.`,
      });
      break;
    }

    // ── Final confirmation ──
    case "confirm_3": {
      if (text !== "CONFIRM SYNC") {
        if (lower === "cancel") {
          deleteSyncSession(userId);
          await client.api.channels.createMessage(channelId, {
            content: "Sync setup cancelled.",
          });
          return;
        }
        await client.api.channels.createMessage(channelId, {
          content:
            "Type exactly **CONFIRM SYNC** to proceed, or **cancel** to abort.",
        });
        return;
      }

      updateSyncSession(userId, { state: "syncing" });

      await client.api.channels.createMessage(channelId, {
        content:
          "Starting sync setup... Creating channel mappings and webhooks.",
      });

      try {
        await executeSyncSetup(client, userId, channelId);
      } catch (error) {
        console.error("[sync] Setup failed:", error);
        await client.api.channels.createMessage(channelId, {
          content: `Sync setup failed: ${error instanceof Error ? error.message : "unknown error"}`,
        });
      }

      deleteSyncSession(userId);
      break;
    }
  }
}

async function executeSyncSetup(
  client: BotClient,
  userId: string,
  dmChannelId: string,
): Promise<void> {
  const session = getSyncSession(userId);
  if (
    !session ||
    !session.guildInfoA ||
    !session.guildInfoB ||
    !session.masterInstance
  ) {
    throw new Error("Invalid session state");
  }

  const peer = getPeerRest();
  if (!peer) throw new Error("Peer API not configured");

  const infoA = session.guildInfoA;
  const infoB = session.guildInfoB;

  const syncConfig = await createSyncConfig({
    guildIdA: infoA.id,
    guildIdB: infoB.id,
    guildNameA: infoA.name,
    guildNameB: infoB.name,
    masterInstance: session.masterInstance,
    status: "initial_sync",
  });

  // Fetch channels from both instances
  const channelsA = await fetchChannelsForGuild(client, infoA.id, "A");
  const channelsB = await fetchChannelsForGuild(client, infoB.id, "B");

  const textVoiceA = channelsA.filter((c) => c.type === 0 || c.type === 2);
  const textVoiceB = channelsB.filter((c) => c.type === 0 || c.type === 2);

  const masterChannels =
    session.masterInstance === "A" ? textVoiceA : textVoiceB;
  const targetChannels =
    session.masterInstance === "A" ? textVoiceB : textVoiceA;

  let created = 0;
  let paired = 0;

  for (const masterCh of masterChannels) {
    let targetCh = targetChannels.find(
      (c) => c.name === masterCh.name && c.type === masterCh.type,
    );

    if (!targetCh) {
      try {
        const targetGuildId =
          session.masterInstance === "A" ? infoB.id : infoA.id;
        const targetInstance = session.masterInstance === "A" ? "B" : "A";
        targetCh = await createChannelOnTarget(
          client,
          targetGuildId,
          masterCh,
          targetInstance,
        );
        created++;
      } catch (error) {
        console.error(
          `[sync] Failed to create channel ${masterCh.name}:`,
          error,
        );
        await client.api.channels.createMessage(dmChannelId, {
          content: `⚠️ Failed to create channel **#${masterCh.name}** on target. Skipping.`,
        });
        continue;
      }
    } else {
      paired++;
    }

    const channelIdA =
      session.masterInstance === "A" ? masterCh.id : targetCh.id;
    const channelIdB =
      session.masterInstance === "A" ? targetCh.id : masterCh.id;

    let webhookA: Webhook | null = null;
    let webhookB: Webhook | null = null;

    if (masterCh.type === 0) {
      if (INSTANCE_ID === "A") {
        webhookA = await createWebhookOnLocal(client, channelIdA);
        webhookB = await createWebhookOnPeer(channelIdB);
      } else {
        webhookA = await createWebhookOnPeer(channelIdA);
        webhookB = await createWebhookOnLocal(client, channelIdB);
      }
    }

    await createSyncChannelMap({
      syncConfigId: syncConfig.id,
      channelIdA,
      channelIdB,
      channelName: masterCh.name,
      webhookIdA: webhookA?.id,
      webhookTokenA: webhookA?.token,
      webhookIdB: webhookB?.id,
      webhookTokenB: webhookB?.token,
    });
  }

  await updateSyncConfigStatus(syncConfig.id, "active");

  await client.api.channels.createMessage(dmChannelId, {
    content:
      `**Sync setup complete!**\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• ${paired} channels paired by name\n` +
      `• ${created} channels created on target\n` +
      `• ${paired + created} total channel mappings\n` +
      `• Bidirectional sync is now **active**\n\n` +
      `Type **!stop** anywhere to emergency halt all sync operations.\n` +
      `Type **!syncstatus** to see active sync jobs.`,
  });
}

async function createChannelOnTarget(
  client: BotClient,
  guildId: string,
  channel: Channel,
  targetInstance: string,
): Promise<Channel> {
  const isLocal =
    (INSTANCE_ID === "A" && targetInstance === "A") ||
    (INSTANCE_ID === "B" && targetInstance === "B");

  if (isLocal) {
    return (await client.api.guilds.createChannel(guildId, {
      name: channel.name,
      type: channel.type as 0 | 2,
    })) as unknown as Channel;
  }

  const peer = getPeerRest();
  if (!peer) throw new Error("Peer API not configured");
  return (await peer.post(`/guilds/${guildId}/channels`, {
    body: {
      name: channel.name,
      type: channel.type,
      position: channel.position,
    },
  })) as Channel;
}

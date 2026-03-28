import { INSTANCE_ID } from "./config.js";
import {
  createSyncChannelMap,
  createSyncConfig,
  updateSyncConfigStatus,
} from "./data/sync.js";
import { getPeerRest } from "./peerClient.js";
import { allInstanceIds, instanceLabel } from "./syncLabels.js";
import {
  deleteSyncSession,
  getSyncSession,
  type SyncGuildInfo,
  updateSyncSession,
} from "./syncSession.js";
import type { BotClient, MessageCreatePayload } from "./types/command.js";

type Channel = {
  id: string;
  name: string;
  type: number;
  position?: number;
  parent_id?: string | null;
};
type Webhook = { id: string; token: string };

async function fetchChannelsForGuild(
  client: BotClient,
  guildId: string,
  instanceId: string,
): Promise<Channel[]> {
  if (instanceId === INSTANCE_ID) {
    return (await client.api.guilds.getChannels(
      guildId,
    )) as unknown as Channel[];
  }
  const peer = getPeerRest(instanceId);
  if (!peer) throw new Error(`Peer ${instanceId} not configured`);
  return (await peer.get(`/guilds/${guildId}/channels`)) as Channel[];
}

async function createWebhookOnInstance(
  client: BotClient,
  channelId: string,
  instanceId: string,
): Promise<Webhook | null> {
  try {
    if (instanceId === INSTANCE_ID) {
      return (await client.api.channels.createWebhook(channelId, {
        name: "Sync Bridge",
      })) as unknown as Webhook;
    }
    const peer = getPeerRest(instanceId);
    if (!peer) return null;
    return (await peer.post(`/channels/${channelId}/webhooks`, {
      body: { name: "Sync Bridge" },
    })) as Webhook;
  } catch (error) {
    console.error(
      `[sync] Failed to create webhook on instance ${instanceId} channel ${channelId}:`,
      error,
    );
    return null;
  }
}

// ── DM handler ──────────────────────────────────────────────────────

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
    // ── Step 2: Pick pair or triplet ──
    case "awaiting_mode": {
      if (text !== "1" && text !== "2") {
        await client.api.channels.createMessage(channelId, {
          content:
            "Type **1** for pair sync or **2** for triplet sync, or **cancel** to abort.",
        });
        return;
      }

      const mode = text === "1" ? "pair" : "triplet";
      updateSyncSession(userId, { mode });
      session.mode = mode;

      // Move to master instance selection
      session.state = "awaiting_master_instance";
      const ids = allInstanceIds();
      const list = ids
        .map((id, i) => `**${i + 1}.** Instance ${id} — ${instanceLabel(id)}`)
        .join("\n");

      await client.api.channels.createMessage(channelId, {
        content:
          `Setting up **${mode}** sync.\n\n` +
          `Which instance should be the **MASTER** (source of truth)?\n` +
          `The master's channels will be mirrored to the other instance(s).\n\n` +
          `${list}\n\n` +
          `Type the number, or **cancel** to abort.`,
      });
      break;
    }

    // ── Step 3: Pick master instance ──
    case "awaiting_master_instance": {
      const ids = allInstanceIds();
      const idx = Number.parseInt(text, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= ids.length) {
        await client.api.channels.createMessage(channelId, {
          content:
            "Invalid selection. Type the number, or **cancel** to abort.",
        });
        return;
      }

      const selectedInstance = ids[idx];

      // Show guilds for this instance
      session.state = "awaiting_master_guild";
      // Store which instance was picked (temporarily in selections array)
      session.selections = [
        {
          instanceId: selectedInstance,
          guild: null as unknown as SyncGuildInfo,
        },
      ];

      const guilds = session.guildLists.get(selectedInstance) ?? [];
      const list = guilds.map((g, i) => `**${i + 1}.** ${g.name}`).join("\n");

      await client.api.channels.createMessage(channelId, {
        content:
          `Selected **Instance ${selectedInstance}** (${instanceLabel(selectedInstance)}) as master.\n\n` +
          `Which server on this instance should be the master?\n\n` +
          `${list}\n\n` +
          `Type the number, or **cancel** to abort.`,
      });
      break;
    }

    // ── Step 3.1: Pick master guild ──
    case "awaiting_master_guild": {
      const masterInstanceId = session.selections[0].instanceId;
      const guilds = session.guildLists.get(masterInstanceId) ?? [];
      const idx = Number.parseInt(text, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= guilds.length) {
        await client.api.channels.createMessage(channelId, {
          content:
            "Invalid selection. Type the number, or **cancel** to abort.",
        });
        return;
      }

      const selectedGuild = guilds[idx];
      let channels: Channel[];
      try {
        channels = await fetchChannelsForGuild(
          client,
          selectedGuild.id,
          masterInstanceId,
        );
      } catch (error) {
        await client.api.channels.createMessage(channelId, {
          content: `Failed to fetch channels: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        return;
      }

      session.selections[0].guild = {
        id: selectedGuild.id,
        name: selectedGuild.name,
        textChannelCount: channels.filter((c) => c.type === 0).length,
        voiceChannelCount: channels.filter((c) => c.type === 2).length,
        categoryCount: channels.filter((c) => c.type === 4).length,
      };

      // Move to second instance selection
      session.state = "awaiting_second_instance";
      const remainingIds = allInstanceIds().filter(
        (id) => !session.selections.some((s) => s.instanceId === id),
      );
      const list = remainingIds
        .map((id, i) => `**${i + 1}.** Instance ${id} — ${instanceLabel(id)}`)
        .join("\n");

      await client.api.channels.createMessage(channelId, {
        content:
          `Master: **${selectedGuild.name}** on Instance ${masterInstanceId} (${instanceLabel(masterInstanceId)})\n\n` +
          `Which instance should be the **second** sync target?\n\n` +
          `${list}\n\n` +
          `Type the number, or **cancel** to abort.`,
      });
      break;
    }

    // ── Step 4: Pick second instance ──
    case "awaiting_second_instance": {
      const remainingIds = allInstanceIds().filter(
        (id) => !session.selections.some((s) => s.instanceId === id),
      );
      const idx = Number.parseInt(text, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= remainingIds.length) {
        await client.api.channels.createMessage(channelId, {
          content:
            "Invalid selection. Type the number, or **cancel** to abort.",
        });
        return;
      }

      const selectedInstance = remainingIds[idx];
      session.selections.push({
        instanceId: selectedInstance,
        guild: null as unknown as SyncGuildInfo,
      });
      session.state = "awaiting_second_guild";

      const guilds = session.guildLists.get(selectedInstance) ?? [];
      const list = guilds.map((g, i) => `**${i + 1}.** ${g.name}`).join("\n");

      await client.api.channels.createMessage(channelId, {
        content:
          `Selected **Instance ${selectedInstance}** (${instanceLabel(selectedInstance)}).\n\n` +
          `Which server on this instance should be synced?\n\n` +
          `${list}\n\n` +
          `Type the number, or **cancel** to abort.`,
      });
      break;
    }

    // ── Step 4.1: Pick second guild ──
    case "awaiting_second_guild": {
      const secondInstanceId = session.selections[1].instanceId;
      const guilds = session.guildLists.get(secondInstanceId) ?? [];
      const idx = Number.parseInt(text, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= guilds.length) {
        await client.api.channels.createMessage(channelId, {
          content:
            "Invalid selection. Type the number, or **cancel** to abort.",
        });
        return;
      }

      const selectedGuild = guilds[idx];
      let channels: Channel[];
      try {
        channels = await fetchChannelsForGuild(
          client,
          selectedGuild.id,
          secondInstanceId,
        );
      } catch (error) {
        await client.api.channels.createMessage(channelId, {
          content: `Failed to fetch channels: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        return;
      }

      session.selections[1].guild = {
        id: selectedGuild.id,
        name: selectedGuild.name,
        textChannelCount: channels.filter((c) => c.type === 0).length,
        voiceChannelCount: channels.filter((c) => c.type === 2).length,
        categoryCount: channels.filter((c) => c.type === 4).length,
      };

      // If triplet, ask for third instance
      if (session.mode === "triplet") {
        session.state = "awaiting_third_instance";
        const remainingIds = allInstanceIds().filter(
          (id) => !session.selections.some((s) => s.instanceId === id),
        );

        if (remainingIds.length === 1) {
          // Only one instance left — auto-select it
          const thirdId = remainingIds[0];
          session.selections.push({
            instanceId: thirdId,
            guild: null as unknown as SyncGuildInfo,
          });
          session.state = "awaiting_third_guild";

          const thirdGuilds = session.guildLists.get(thirdId) ?? [];
          const list = thirdGuilds
            .map((g, i) => `**${i + 1}.** ${g.name}`)
            .join("\n");

          await client.api.channels.createMessage(channelId, {
            content:
              `The remaining instance is **Instance ${thirdId}** (${instanceLabel(thirdId)}).\n\n` +
              `Which server on this instance should be synced?\n\n` +
              `${list}\n\n` +
              `Type the number, or **cancel** to abort.`,
          });
        } else {
          const list = remainingIds
            .map(
              (id, i) => `**${i + 1}.** Instance ${id} — ${instanceLabel(id)}`,
            )
            .join("\n");

          await client.api.channels.createMessage(channelId, {
            content:
              `Which instance should be the **third** sync target?\n\n` +
              `${list}\n\n` +
              `Type the number, or **cancel** to abort.`,
          });
        }
        break;
      }

      // Pair mode — show confirmation
      await showConfirmation(client, channelId, session);
      session.state = "confirm";
      break;
    }

    // ── Step 4 (triplet): Pick third instance ──
    case "awaiting_third_instance": {
      const remainingIds = allInstanceIds().filter(
        (id) => !session.selections.some((s) => s.instanceId === id),
      );
      const idx = Number.parseInt(text, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= remainingIds.length) {
        await client.api.channels.createMessage(channelId, {
          content:
            "Invalid selection. Type the number, or **cancel** to abort.",
        });
        return;
      }

      const selectedInstance = remainingIds[idx];
      session.selections.push({
        instanceId: selectedInstance,
        guild: null as unknown as SyncGuildInfo,
      });
      session.state = "awaiting_third_guild";

      const guilds = session.guildLists.get(selectedInstance) ?? [];
      const list = guilds.map((g, i) => `**${i + 1}.** ${g.name}`).join("\n");

      await client.api.channels.createMessage(channelId, {
        content:
          `Selected **Instance ${selectedInstance}** (${instanceLabel(selectedInstance)}).\n\n` +
          `Which server on this instance should be synced?\n\n` +
          `${list}\n\n` +
          `Type the number, or **cancel** to abort.`,
      });
      break;
    }

    // ── Step 4.1 (triplet): Pick third guild ──
    case "awaiting_third_guild": {
      const thirdInstanceId = session.selections[2].instanceId;
      const guilds = session.guildLists.get(thirdInstanceId) ?? [];
      const idx = Number.parseInt(text, 10) - 1;
      if (Number.isNaN(idx) || idx < 0 || idx >= guilds.length) {
        await client.api.channels.createMessage(channelId, {
          content:
            "Invalid selection. Type the number, or **cancel** to abort.",
        });
        return;
      }

      const selectedGuild = guilds[idx];
      let channels: Channel[];
      try {
        channels = await fetchChannelsForGuild(
          client,
          selectedGuild.id,
          thirdInstanceId,
        );
      } catch (error) {
        await client.api.channels.createMessage(channelId, {
          content: `Failed to fetch channels: ${error instanceof Error ? error.message : "unknown error"}`,
        });
        return;
      }

      session.selections[2].guild = {
        id: selectedGuild.id,
        name: selectedGuild.name,
        textChannelCount: channels.filter((c) => c.type === 0).length,
        voiceChannelCount: channels.filter((c) => c.type === 2).length,
        categoryCount: channels.filter((c) => c.type === 4).length,
      };

      // Show confirmation
      await showConfirmation(client, channelId, session);
      session.state = "confirm";
      break;
    }

    // ── Step 5 & 6: Confirmation ──
    case "confirm": {
      if (text !== "CONFIRM SYNC") {
        if (lower === "no" || lower === "n") {
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
        if (session.mode === "triplet") {
          await executeTripletSyncSetup(client, userId, channelId, session);
        } else {
          await executePairSyncSetup(client, userId, channelId, session);
        }
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

// ── Confirmation summary ────────────────────────────────────────────

async function showConfirmation(
  client: BotClient,
  channelId: string,
  session: ReturnType<typeof getSyncSession>,
): Promise<void> {
  if (!session) return;
  const master = session.selections[0];
  const lines: string[] = ["**Sync Plan**", "━━━━━━━━━━━━━━━━━━━━", ""];

  for (let i = 0; i < session.selections.length; i++) {
    const sel = session.selections[i];
    const role = i === 0 ? "MASTER" : `Target ${i}`;
    lines.push(
      `**${role}:** Instance ${sel.instanceId} — ${instanceLabel(sel.instanceId)}`,
      `  Server: **${sel.guild.name}** (${sel.guild.categoryCount} categories, ${sel.guild.textChannelCount} text, ${sel.guild.voiceChannelCount} voice)`,
      "",
    );
  }

  if (session.mode === "triplet") {
    lines.push(
      "This will create **3 sync pairs** between all instances.",
      `Channels from **${master.guild.name}** will be mirrored to both targets.`,
    );
  } else {
    lines.push(
      `Channels from **${master.guild.name}** will be mirrored to the target.`,
    );
  }

  lines.push(
    "",
    "**What will happen:**",
    "• Channels on target(s) that don't exist on the master will be **deleted**",
    "• Missing channels will be created on the target(s)",
    "• Matching channels will be paired by name",
    "• Webhooks will be created to preserve author names/avatars",
    "• After setup, all future messages sync in all directions",
    "",
    "⚠️ **This is destructive and cannot be easily undone.**",
    "Type **CONFIRM SYNC** to begin, or **cancel** to abort.",
  );

  await client.api.channels.createMessage(channelId, {
    content: lines.join("\n"),
  });
}

// ── Pair sync execution ─────────────────────────────────────────────

async function executePairSyncSetup(
  client: BotClient,
  _userId: string,
  dmChannelId: string,
  session: NonNullable<ReturnType<typeof getSyncSession>>,
): Promise<void> {
  const master = session.selections[0];
  const target = session.selections[1];

  const result = await executeSinglePairSetup(
    client,
    dmChannelId,
    master.instanceId,
    target.instanceId,
    master.guild,
    target.guild,
    master.instanceId,
  );

  await client.api.channels.createMessage(dmChannelId, {
    content:
      `**Sync setup complete!**\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• ${result.deleted} channels deleted on target\n` +
      `• ${result.paired} channels paired by name\n` +
      `• ${result.created} channels created on target\n` +
      `• ${result.paired + result.created} total channel mappings\n` +
      `• Bidirectional sync is now **active**\n\n` +
      `Type **!stop** anywhere to emergency halt all sync operations.\n` +
      `Type **!syncstatus** to see active sync jobs.`,
  });
}

// ── Triplet sync execution ──────────────────────────────────────────

async function executeTripletSyncSetup(
  client: BotClient,
  _userId: string,
  dmChannelId: string,
  session: NonNullable<ReturnType<typeof getSyncSession>>,
): Promise<void> {
  const master = session.selections[0];
  const [sel0, sel1, sel2] = session.selections;

  const tripletId = `triplet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const pairs: [typeof sel0, typeof sel0][] = [
    [sel0, sel1],
    [sel0, sel2],
    [sel1, sel2],
  ];

  let totalPaired = 0;
  let totalCreated = 0;
  let totalDeleted = 0;

  for (const [a, b] of pairs) {
    await client.api.channels.createMessage(dmChannelId, {
      content: `Setting up pair: **${a.guild.name}** (${instanceLabel(a.instanceId)}) ↔ **${b.guild.name}** (${instanceLabel(b.instanceId)})...`,
    });

    const result = await executeSinglePairSetup(
      client,
      dmChannelId,
      a.instanceId,
      b.instanceId,
      a.guild,
      b.guild,
      master.instanceId,
      tripletId,
    );

    totalPaired += result.paired;
    totalCreated += result.created;
    totalDeleted += result.deleted;
  }

  await client.api.channels.createMessage(dmChannelId, {
    content:
      `**Triplet sync setup complete!**\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `• 3 sync pairs created\n` +
      `• ${totalDeleted} channels deleted on targets\n` +
      `• ${totalPaired} channels paired by name\n` +
      `• ${totalCreated} channels created on targets\n` +
      `• Tridirectional sync is now **active**\n\n` +
      `Type **!stop** anywhere to emergency halt all sync operations.\n` +
      `Type **!syncstatus** to see active sync jobs.`,
  });
}

// ── Single pair setup (reusable) ────────────────────────────────────

async function executeSinglePairSetup(
  client: BotClient,
  dmChannelId: string,
  instanceIdA: string,
  instanceIdB: string,
  infoA: SyncGuildInfo,
  infoB: SyncGuildInfo,
  masterInstance: string,
  tripletId?: string,
): Promise<{ paired: number; created: number; deleted: number }> {
  const syncConfig = await createSyncConfig({
    guildIdA: infoA.id,
    guildIdB: infoB.id,
    guildNameA: infoA.name,
    guildNameB: infoB.name,
    instanceA: instanceIdA,
    instanceB: instanceIdB,
    masterInstance,
    tripletId,
    status: "initial_sync",
  });

  const channelsA = await fetchChannelsForGuild(client, infoA.id, instanceIdA);
  const channelsB = await fetchChannelsForGuild(client, infoB.id, instanceIdB);

  // Include categories (type 4), text (type 0), and voice (type 2)
  const syncableTypes = new Set([0, 2, 4]);
  const filteredA = channelsA
    .filter((c) => syncableTypes.has(c.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const filteredB = channelsB
    .filter((c) => syncableTypes.has(c.type))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const masterIsSideA = masterInstance === instanceIdA;
  const masterChannels = masterIsSideA ? filteredA : filteredB;
  const targetChannels = masterIsSideA ? filteredB : filteredA;
  const targetInstanceId = masterIsSideA ? instanceIdB : instanceIdA;
  const targetGuildId = masterIsSideA ? infoB.id : infoA.id;

  // Separate categories from child channels on master
  const masterCategories = masterChannels.filter((c) => c.type === 4);
  const masterChildren = masterChannels.filter((c) => c.type !== 4);
  const targetCategories = targetChannels.filter((c) => c.type === 4);
  const targetChildren = targetChannels.filter((c) => c.type !== 4);

  // ── Delete channels on target that don't exist on master ──
  // Delete children first, then categories (to avoid "category not empty" errors)
  let deleted = 0;

  for (const targetCh of targetChildren) {
    const existsOnMaster = masterChildren.some(
      (c) => c.name === targetCh.name && c.type === targetCh.type,
    );
    if (!existsOnMaster) {
      try {
        await deleteChannelOnInstance(client, targetCh.id, targetInstanceId);
        console.log(
          `[sync] Deleted channel #${targetCh.name} (type=${targetCh.type}) on instance ${targetInstanceId}`,
        );
        deleted++;
      } catch (error) {
        console.error(
          `[sync] Failed to delete channel #${targetCh.name}:`,
          error,
        );
        await client.api.channels.createMessage(dmChannelId, {
          content: `⚠️ Failed to delete channel **#${targetCh.name}** on Instance ${targetInstanceId}. Skipping.`,
        });
      }
    }
  }

  for (const targetCat of targetCategories) {
    const existsOnMaster = masterCategories.some(
      (c) => c.name === targetCat.name,
    );
    if (!existsOnMaster) {
      try {
        await deleteChannelOnInstance(client, targetCat.id, targetInstanceId);
        console.log(
          `[sync] Deleted category ${targetCat.name} on instance ${targetInstanceId}`,
        );
        deleted++;
      } catch (error) {
        console.error(
          `[sync] Failed to delete category ${targetCat.name}:`,
          error,
        );
      }
    }
  }

  // ── Create/pair categories first ──
  // Maps master category ID → target category ID
  const categoryIdMap = new Map<string, string>();
  const pairedTargetIds = new Set<string>();

  for (const masterCat of masterCategories) {
    let targetCat = targetCategories.find(
      (c) => c.name === masterCat.name && !pairedTargetIds.has(c.id),
    );

    if (!targetCat) {
      try {
        console.log(
          `[sync] Creating category "${masterCat.name}" on instance ${targetInstanceId}`,
        );
        targetCat = await createChannelOnInstance(
          client,
          targetGuildId,
          { ...masterCat, parent_id: null },
          targetInstanceId,
        );
      } catch (error) {
        console.error(
          `[sync] Failed to create category ${masterCat.name}:`,
          error,
        );
        continue;
      }
    } else {
      pairedTargetIds.add(targetCat.id);
    }

    categoryIdMap.set(masterCat.id, targetCat.id);
  }

  // ── Create/pair child channels (text & voice) ──
  let created = 0;
  let paired = 0;

  for (const masterCh of masterChildren) {
    // Match by name AND type to prevent voice/text cross-pairing
    let targetCh = targetChildren.find(
      (c) =>
        c.name === masterCh.name &&
        c.type === masterCh.type &&
        !pairedTargetIds.has(c.id),
    );

    if (!targetCh) {
      try {
        // Map parent_id from master category to target category
        const targetParentId = masterCh.parent_id
          ? (categoryIdMap.get(masterCh.parent_id) ?? null)
          : null;
        console.log(
          `[sync] Creating channel #${masterCh.name} (type=${masterCh.type}) on instance ${targetInstanceId}`,
        );
        targetCh = await createChannelOnInstance(
          client,
          targetGuildId,
          { ...masterCh, parent_id: targetParentId },
          targetInstanceId,
        );
        created++;
      } catch (error) {
        console.error(
          `[sync] Failed to create channel ${masterCh.name}:`,
          error,
        );
        await client.api.channels.createMessage(dmChannelId, {
          content: `⚠️ Failed to create channel **#${masterCh.name}** (type=${masterCh.type}) on Instance ${targetInstanceId}. Skipping.`,
        });
        continue;
      }
    } else {
      pairedTargetIds.add(targetCh.id);
      paired++;
    }

    // Only map text channels (type 0) — voice channels and categories don't need message sync
    if (masterCh.type !== 0) continue;

    const channelIdSideA = masterIsSideA ? masterCh.id : targetCh.id;
    const channelIdSideB = masterIsSideA ? targetCh.id : masterCh.id;

    const webhookA = await createWebhookOnInstance(
      client,
      channelIdSideA,
      instanceIdA,
    );
    const webhookB = await createWebhookOnInstance(
      client,
      channelIdSideB,
      instanceIdB,
    );

    await createSyncChannelMap({
      syncConfigId: syncConfig.id,
      channelIdA: channelIdSideA,
      channelIdB: channelIdSideB,
      channelName: masterCh.name,
      webhookIdA: webhookA?.id,
      webhookTokenA: webhookA?.token,
      webhookIdB: webhookB?.id,
      webhookTokenB: webhookB?.token,
    });
  }

  await updateSyncConfigStatus(syncConfig.id, "active");
  return { paired, created, deleted };
}

async function deleteChannelOnInstance(
  client: BotClient,
  channelId: string,
  instanceId: string,
): Promise<void> {
  if (instanceId === INSTANCE_ID) {
    await client.api.channels.delete(channelId);
    return;
  }
  const peer = getPeerRest(instanceId);
  if (!peer) throw new Error(`Peer ${instanceId} not configured`);
  await peer.delete(`/channels/${channelId}`);
}

async function createChannelOnInstance(
  client: BotClient,
  guildId: string,
  channel: Channel,
  instanceId: string,
): Promise<Channel> {
  const body: Record<string, unknown> = {
    name: channel.name,
    type: channel.type,
  };
  if (channel.position != null) body.position = channel.position;
  if (channel.parent_id) body.parent_id = channel.parent_id;

  if (instanceId === INSTANCE_ID) {
    return (await client.api.guilds.createChannel(
      guildId,
      body as Parameters<typeof client.api.guilds.createChannel>[1],
    )) as unknown as Channel;
  }

  const peer = getPeerRest(instanceId);
  if (!peer) throw new Error(`Peer ${instanceId} not configured`);
  return (await peer.post(`/guilds/${guildId}/channels`, { body })) as Channel;
}

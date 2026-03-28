import { INSTANCE_ID, PEERS } from "../config.js";
import { getPeerRest, hasPeerConfig } from "../peerClient.js";
import { instanceLabel } from "../syncLabels.js";
import { createSyncSession } from "../syncSession.js";
import type { Command } from "../types/command.js";

// Hidden command — not listed in !help
export const name: Command["name"] = "sync";

export const execute: Command["execute"] = async (
  client,
  message,
): Promise<void> => {
  const userId = message.author?.id;
  if (!userId) return;

  if (!INSTANCE_ID) {
    await client.api.channels.createMessage(message.channel_id, {
      content: "Sync is not configured. Set `INSTANCE_ID` in your environment.",
    });
    return;
  }

  if (!hasPeerConfig()) {
    await client.api.channels.createMessage(message.channel_id, {
      content:
        "Sync is not configured. Set peer environment variables (e.g. `PEER_B_API_BASE_URL`).",
    });
    return;
  }

  // DM the user to walk through setup
  const dmChannel = await client.api.users.createDM(userId);
  const dm = dmChannel as { id: string };

  // Notify in the channel that setup is happening in DMs
  if (message.guild_id) {
    const notice = await client.api.channels.createMessage(message.channel_id, {
      content: "Check your DMs — I'll walk you through sync setup there.",
    });
    setTimeout(async () => {
      try {
        await client.api.channels.deleteMessage(message.channel_id, message.id);
        await client.api.channels.deleteMessage(
          message.channel_id,
          (notice as { id: string }).id,
        );
      } catch {
        /* ignore */
      }
    }, 10_000);
  }

  await client.api.channels.createMessage(dm.id, {
    content: "Scanning all configured instances...",
  });

  // Fetch guilds from each instance
  type GuildList = { id: string; name: string }[];
  const guildsByInstance = new Map<string, GuildList>();

  // Local instance
  try {
    const guilds = (await client.api.users.getGuilds()) as unknown as GuildList;
    guildsByInstance.set(INSTANCE_ID, guilds);
  } catch (error) {
    await client.api.channels.createMessage(dm.id, {
      content: `Failed to fetch local guilds (Instance ${INSTANCE_ID}): ${error instanceof Error ? error.message : "unknown error"}`,
    });
    return;
  }

  // Peer instances
  for (const peerId of PEERS.keys()) {
    const peer = getPeerRest(peerId);
    if (!peer) continue;
    try {
      const guilds = (await peer.get("/users/@me/guilds")) as GuildList;
      guildsByInstance.set(peerId, guilds);
    } catch (error) {
      await client.api.channels.createMessage(dm.id, {
        content: `Failed to fetch guilds from Instance ${peerId} (${instanceLabel(peerId)}): ${error instanceof Error ? error.message : "unknown error"}`,
      });
      return;
    }
  }

  // Validate all instances have guilds
  for (const [id, guilds] of guildsByInstance) {
    if (guilds.length === 0) {
      await client.api.channels.createMessage(dm.id, {
        content: `Instance ${id} (${instanceLabel(id)}) bot is not in any servers.`,
      });
      return;
    }
  }

  // Create session and store guild lists
  const session = createSyncSession(userId);
  session.dmChannelId = dm.id;
  for (const [id, guilds] of guildsByInstance) {
    session.guildLists.set(id, guilds);
  }

  const instanceIds = [...guildsByInstance.keys()].sort();

  // If only 2 instances, skip mode selection
  if (instanceIds.length <= 2) {
    session.mode = "pair";
    session.state = "awaiting_master_instance";

    const instanceList = instanceIds
      .map((id, i) => `**${i + 1}.** Instance ${id} — ${instanceLabel(id)}`)
      .join("\n");

    await client.api.channels.createMessage(dm.id, {
      content:
        `Found **${instanceIds.length} instances** configured.\n\n` +
        `Which instance should be the **MASTER** (source of truth)?\n` +
        `The master's channels will be mirrored to the other instance.\n\n` +
        `${instanceList}\n\n` +
        `Type the number, or **cancel** to abort.`,
    });
    return;
  }

  // 3+ instances — ask pair or triplet
  const instanceList = instanceIds
    .map(
      (id) =>
        `  • **Instance ${id}** — ${instanceLabel(id)} (${guildsByInstance.get(id)?.length} servers)`,
    )
    .join("\n");

  await client.api.channels.createMessage(dm.id, {
    content:
      `Found **${instanceIds.length} instances** configured:\n\n` +
      `${instanceList}\n\n` +
      `How would you like to sync?\n\n` +
      `**1.** Pair — sync 2 instances together\n` +
      `**2.** Triplet — sync all 3 instances together\n\n` +
      `Type **1** or **2**, or **cancel** to abort.`,
  });
};

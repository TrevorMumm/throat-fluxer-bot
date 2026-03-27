import { API_BASE_URL, INSTANCE_ID, PEER_API_BASE_URL } from "../config.js";
import { getPeerRest, hasPeerConfig } from "../peerClient.js";
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
        "Sync is not configured. Set `PEER_API_BASE_URL` and `PEER_BOT_TOKEN` in your environment.",
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
    content: "Scanning both Fluxer instances...",
  });

  // Fetch guilds from both instances
  const labelA = INSTANCE_ID === "A" ? API_BASE_URL : PEER_API_BASE_URL;
  const _labelB = INSTANCE_ID === "A" ? PEER_API_BASE_URL : API_BASE_URL;

  let guildsLocal: { id: string; name: string }[];
  let guildsPeer: { id: string; name: string }[];

  try {
    guildsLocal = (await client.api.users.getGuilds()) as unknown as {
      id: string;
      name: string;
    }[];
  } catch (error) {
    await client.api.channels.createMessage(dm.id, {
      content: `Failed to fetch local guilds: ${error instanceof Error ? error.message : "unknown error"}`,
    });
    return;
  }

  try {
    const peer = getPeerRest();
    if (!peer) throw new Error("Peer API not configured");
    guildsPeer = (await peer.get("/users/@me/guilds")) as {
      id: string;
      name: string;
    }[];
  } catch (error) {
    await client.api.channels.createMessage(dm.id, {
      content: `Failed to fetch peer guilds: ${error instanceof Error ? error.message : "unknown error"}`,
    });
    return;
  }

  // Assign A/B based on INSTANCE_ID
  const guildsA = INSTANCE_ID === "A" ? guildsLocal : guildsPeer;
  const guildsB = INSTANCE_ID === "A" ? guildsPeer : guildsLocal;

  if (guildsA.length === 0) {
    await client.api.channels.createMessage(dm.id, {
      content: "Instance A bot is not in any servers.",
    });
    return;
  }

  if (guildsB.length === 0) {
    await client.api.channels.createMessage(dm.id, {
      content: "Instance B bot is not in any servers.",
    });
    return;
  }

  // Create session and store guild lists
  const session = createSyncSession(userId);
  session.guildsA = guildsA;
  session.guildsB = guildsB;
  session.dmChannelId = dm.id;
  session.state = "awaiting_guild_a";

  // Present Instance A guild list
  const listA = guildsA.map((g, i) => `**${i + 1}.** ${g.name}`).join("\n");

  await client.api.channels.createMessage(dm.id, {
    content:
      `**Instance A** — ${labelA}\n` +
      `The bot has access to ${guildsA.length} server(s):\n\n` +
      `${listA}\n\n` +
      `Which server on **Instance A** should be synced?\n` +
      `Type the number, or **cancel** to abort.`,
  });
};

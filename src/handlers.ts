import { type Client, GatewayDispatchEvents } from "@discordjs/core";
import { loadCommands } from "./commandLoader.js";
import { recordCommandInvocation } from "./data/commandInvocations.js";
import { getGuildPrefix } from "./data/guildSettings.js";
import { handlePollDM } from "./pollDmHandler.js";
import {
  handlePollReaction,
  handlePollReactionRemove,
} from "./pollReaction.js";
import { getSession } from "./pollSession.js";
import { normalizePrefix } from "./prefix.js";
import { handlePurgeReply } from "./purgeAllHandler.js";
import { getPurgeSession } from "./purgeSession.js";
import { handleSyncDM } from "./syncDmHandler.js";
import { captureChannelDeleteEvent, captureSyncEvent } from "./syncEngine.js";
import { getSyncSession } from "./syncSession.js";

const DEFAULT_PREFIX = normalizePrefix(process.env.COMMAND_PREFIX, "!");

/**
 * This function registers event handlers for the bot client.
 * It listens for the "Ready" event to log when the bot is ready, and for the "MessageCreate" event to handle incoming messages.
 * When a message is created, it checks if the message starts with the defined prefix and if it does, it attempts to execute the corresponding command.
 * The commands are loaded using the loadCommands function, which retrieves all available commands and their execution logic.
 * The command execution is done by calling the execute function of the matched command, passing in the client, message, and any arguments extracted from the message content.
 * This function is essential for setting up the bot's interaction with users and enabling it to respond to commands in the chat.
 * @param client
 */

export async function registerHandlers(client: Client): Promise<void> {
  const commands = await loadCommands();
  let botId: string | undefined;
  let mentionPrefixRegex: RegExp | null = null;
  let mentionOnlyRegex: RegExp | null = null;

  client.once(GatewayDispatchEvents.Ready, ({ data }) => {
    const { username, id: userid, discriminator } = data.user; // Destructure the username, discriminator, and id from the user data
    const tag = `${username}#${discriminator}`;
    botId = userid;
    const safeBotId = botId && /^\d+$/.test(botId) ? botId : undefined;
    mentionPrefixRegex = safeBotId
      ? new RegExp(`^<@!?${safeBotId}>\\s*`)
      : null;
    mentionOnlyRegex = safeBotId ? new RegExp(`^<@!?${safeBotId}>`) : null;
    console.log(`Ready as ${tag}`);
  });

  client.on(GatewayDispatchEvents.MessageCreate, async ({ data: message }) => {
    if (message.author?.bot) return;

    const guildId = message.guild_id;

    // ── Poll DM session routing ──
    // If this is a DM and the user has an active poll session,
    // route to the poll handler instead of treating it as a command.
    if (!guildId && message.author?.id) {
      const session = getSession(message.author.id);
      if (session) {
        // Still allow !poll to restart, but route everything else to poll handler
        const trimmed = message.content.trim().toLowerCase();
        const prefix = normalizePrefix(undefined, DEFAULT_PREFIX) ?? "!";
        if (trimmed === `${prefix}poll`) {
          // Let it fall through to command handling below
        } else {
          await handlePollDM(client, message as never);
          return;
        }
      }
    }

    // ── Sync DM session routing ──
    if (!guildId && message.author?.id) {
      const syncSession = getSyncSession(message.author.id);
      if (syncSession) {
        const trimmed = message.content.trim().toLowerCase();
        const prefix = normalizePrefix(undefined, DEFAULT_PREFIX) ?? "!";
        if (trimmed === `${prefix}sync`) {
          // Let it fall through to command handling below
        } else {
          await handleSyncDM(client, message as never);
          return;
        }
      }
    }

    // ── Purge-all session routing ──
    // If the user has an active purge-all confirmation session in this channel,
    // route their reply to the purge handler before treating it as a command.
    if (guildId && message.author?.id) {
      const purgeSession = getPurgeSession(
        message.author.id,
        message.channel_id,
      );
      if (purgeSession) {
        const consumed = await handlePurgeReply(client, message as never);
        if (consumed) return;
      }
    }

    const guildPrefix = guildId ? await getGuildPrefix(guildId) : null;
    const prefix = normalizePrefix(guildPrefix ?? undefined, DEFAULT_PREFIX);
    if (!prefix) return;

    const isMentionPrefix = mentionPrefixRegex
      ? mentionPrefixRegex.test(message.content)
      : false;

    const usesTextPrefix = message.content.startsWith(prefix);

    // ── Sync event capture ──
    // Capture non-command messages for syncing to the peer instance.
    if (!usesTextPrefix && !isMentionPrefix && guildId) {
      try {
        const raw = message as unknown as {
          author?: { username?: string; avatar?: string };
          attachments?: {
            url: string;
            filename: string;
            content_type?: string;
          }[];
          embeds?: unknown[];
        };
        await captureSyncEvent(
          message.channel_id,
          message.id,
          raw.author?.username ?? "Unknown",
          raw.author?.avatar,
          message.content,
          raw.attachments ?? [],
          raw.embeds ?? [],
        );
      } catch (error) {
        console.error("[sync] Failed to capture event:", error);
      }
      return;
    }

    if (!usesTextPrefix && !isMentionPrefix) return;

    if (!usesTextPrefix && !mentionPrefixRegex) return;

    let body = "";
    if (usesTextPrefix) {
      body = message.content.slice(prefix.length).trim();
    } else if (mentionPrefixRegex) {
      body = message.content.replace(mentionPrefixRegex, "").trim();
    }
    const mentionRegex = mentionOnlyRegex ?? /^<@!?\d+>/;

    // Ignore messages that are just mentions, as they are likely not intended as commands.
    // Unless the command is specifically designed to handle mentions, in which case it should be invoked with the appropriate command name.
    if (!body || mentionRegex.test(body)) return;

    const [commandName, ...args] = body.split(/\s+/);
    const command = commands.get(commandName);
    // TODO: Do a help command that lists all available commands and their descriptions.
    if (!command) {
      await client.api.channels.createMessage(message.channel_id, {
        content: `Unknown command: ${commandName}, Use \`${prefix}help\` to see available commands.`,
        allowed_mentions: { parse: [] }, //this prevents the bot from pinging anyone in the error message.
      });
      return;
    }

    try {
      await recordCommandInvocation({
        command: commandName,
        guildId: message.guild_id,
        channelId: message.channel_id,
        userId: message.author?.id,
      });
    } catch (error) {
      console.error("Failed to record command invocation:", error);
    }

    await command.execute(client, message, args);
  });

  // ── Reaction handler (poll voting) ──
  client.on(GatewayDispatchEvents.MessageReactionAdd, async ({ data }) => {
    try {
      await handlePollReaction(
        client,
        {
          channel_id: data.channel_id,
          message_id: data.message_id,
          user_id: data.user_id,
          emoji: {
            name: data.emoji.name ?? undefined,
            id: data.emoji.id ?? undefined,
          },
        },
        botId,
      );
    } catch (error) {
      console.error("Failed to handle poll reaction:", error);
    }
  });

  // ── Reaction remove handler (poll vote removal) ──
  client.on(GatewayDispatchEvents.MessageReactionRemove, async ({ data }) => {
    try {
      await handlePollReactionRemove(
        client,
        {
          channel_id: data.channel_id,
          message_id: data.message_id,
          user_id: data.user_id,
          emoji: {
            name: data.emoji.name ?? undefined,
            id: data.emoji.id ?? undefined,
          },
        },
        botId,
      );
    } catch (error) {
      console.error("Failed to handle poll reaction removal:", error);
    }
  });

  // ── Channel delete handler (sync) ──
  client.on(GatewayDispatchEvents.ChannelDelete, async ({ data }) => {
    try {
      await captureChannelDeleteEvent(data.id);
    } catch (error) {
      console.error("[sync] Failed to capture channel delete:", error);
    }
  });
}

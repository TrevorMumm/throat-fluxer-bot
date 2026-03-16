import type { BotClient, MessageCreatePayload } from "./types/command.js";
import {
  deletePurgeSession,
  getPurgeSession,
  updatePurgeSession,
} from "./purgeSession.js";

const FETCH_LIMIT = 100;

/**
 * Handles a follow-up message from a user who has an active purge-all session.
 * Returns `true` if the message was consumed by this handler (so the main
 * handler should stop processing it as a command).
 */
export async function handlePurgeReply(
  client: BotClient,
  message: MessageCreatePayload,
): Promise<boolean> {
  const userId = message.author?.id;
  if (!userId) return false;

  const session = getPurgeSession(userId, message.channel_id);
  if (!session) return false;

  const reply = message.content.trim().toLowerCase();

  // ── Step 1: y/n confirmation ──
  if (session.state === "awaiting_confirmation") {
    if (reply === "n") {
      deletePurgeSession(userId, message.channel_id);
      await client.api.channels.createMessage(message.channel_id, {
        content: "Task cancelled.",
      });
      return true;
    }

    if (reply === "y") {
      updatePurgeSession(userId, message.channel_id, {
        state: "awaiting_code",
      });
      await client.api.channels.createMessage(message.channel_id, {
        content: `To start this process, type the following characters as you see them: **${session.confirmationCode}**`,
      });
      return true;
    }

    // Invalid input — remind them
    await client.api.channels.createMessage(message.channel_id, {
      content: "Please reply with **y** or **n**.",
    });
    return true;
  }

  // ── Step 2: code confirmation ──
  if (session.state === "awaiting_code") {
    if (reply !== session.confirmationCode) {
      deletePurgeSession(userId, message.channel_id);
      await client.api.channels.createMessage(message.channel_id, {
        content:
          "Confirmation code did not match. Operation cancelled.",
      });
      return true;
    }

    // Code matched — start deleting
    deletePurgeSession(userId, message.channel_id);

    await client.api.channels.createMessage(message.channel_id, {
      content: "Purging all messages in this channel… this may take a while.",
    });

    await purgeAllMessages(client, message.channel_id);
    return true;
  }

  return false;
}

async function purgeAllMessages(
  client: BotClient,
  channelId: string,
): Promise<void> {
  let deleted = 0;

  // Loop until there are no more messages to fetch
  for (;;) {
    let messages: { id: string }[];
    try {
      messages = await client.api.channels.getMessages(channelId, {
        limit: FETCH_LIMIT,
      });
    } catch (error) {
      console.error("Failed to fetch messages during purge all:", error);
      break;
    }

    if (messages.length === 0) break;

    for (const msg of messages) {
      try {
        await client.api.channels.deleteMessage(channelId, msg.id);
        deleted++;
      } catch (error) {
        console.error(`Failed to delete message ${msg.id}:`, error);
      }
    }
  }

  console.log(`Purge all: deleted ${deleted} messages in channel ${channelId}`);
}

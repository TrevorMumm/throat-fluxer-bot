import type {
  BotClient,
  Command,
  MessageCreatePayload,
} from "../types/command.js";

const MAX_PURGE = 100;
const CONFIRMATION_DELAY_MS = 10_000;

export const name: Command["name"] = "purge";

export async function execute(
  client: BotClient,
  message: MessageCreatePayload,
  args: string[],
): Promise<void> {
  const guildId = message.guild_id;

  if (!guildId) {
    await client.api.channels.createMessage(message.channel_id, {
      content: "This command can only be used in a server.",
    });
    return;
  }

  const count = Number(args[0]);

  if (!args[0] || !Number.isInteger(count) || count < 1) {
    await client.api.channels.createMessage(message.channel_id, {
      content: "Usage: `!purge <number>` — number must be between 1 and 100.",
    });
    return;
  }

  if (count > MAX_PURGE) {
    await client.api.channels.createMessage(message.channel_id, {
      content: `You can only purge up to ${MAX_PURGE} messages at a time.`,
    });
    return;
  }

  let fetched: { id: string }[];
  try {
    fetched = await client.api.channels.getMessages(message.channel_id, {
      limit: count + 1,
    });
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    await client.api.channels.createMessage(message.channel_id, {
      content:
        "Failed to fetch messages. Make sure I have the **Read Message History** permission.",
    });
    return;
  }

  const messageIds = fetched.map((m) => m.id);

  if (messageIds.length === 0) {
    await client.api.channels.createMessage(message.channel_id, {
      content: "No messages found to delete.",
    });
    return;
  }

  try {
    // Delete messages one by one — the local API may not support bulk delete
    await Promise.all(
      messageIds.map((id) =>
        client.api.channels.deleteMessage(message.channel_id, id),
      ),
    );
  } catch (error) {
    console.error("Failed to delete messages:", error);
    await client.api.channels.createMessage(message.channel_id, {
      content:
        "Failed to delete messages. Make sure I have the **Manage Messages** permission.",
    });
    return;
  }

  // Subtract 1 because the purge command itself is included
  const purgedCount = messageIds.length - 1;

  const confirmation = await client.api.channels.createMessage(
    message.channel_id,
    {
      content: `${purgedCount} messages have been purged from chat history.`,
    },
  );

  setTimeout(async () => {
    try {
      await client.api.channels.deleteMessage(
        message.channel_id,
        confirmation.id,
      );
    } catch {
      // Confirmation message may already be deleted
    }
  }, CONFIRMATION_DELAY_MS);
}

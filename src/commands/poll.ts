import type { Command } from "../types/command.js";
import { createSession } from "../pollSession.js";

export const name: Command["name"] = "poll";

export const execute: Command["execute"] = async (
  client,
  message,
): Promise<void> => {
  const userId = message.author?.id;
  if (!userId) return;

  const guildId = message.guild_id;

  if (guildId) {
    // Command used in a server — DM the user to walk through setup
    try {
      const dmChannel = await client.api.users.createDM(userId);
      const dm = dmChannel as any;

      createSession(userId, guildId);

      await client.api.channels.createMessage(dm.id, {
        content:
          "**Let's create a poll!**\n\n" +
          "What is your poll question/text?\n\n" +
          "Type **cancel** at any time to cancel.",
      });

      const botReply = await client.api.channels.createMessage(message.channel_id, {
        content: "Check your DMs! I've sent you a message to set up your poll.",
      });

      // Clean up both the user's command and the bot's reply from the server channel
      setTimeout(async () => {
        try {
          await client.api.channels.deleteMessage(message.channel_id, message.id);
        } catch (e) {
          console.error("Failed to delete user's !poll message:", e);
        }
        try {
          await client.api.channels.deleteMessage(message.channel_id, (botReply as any).id);
        } catch (e) {
          console.error("Failed to delete bot's DM notice:", e);
        }
      }, 10000);
    } catch (error) {
      console.error("Failed to create DM for poll:", error);
      await client.api.channels.createMessage(message.channel_id, {
        content:
          "I couldn't send you a DM. Please make sure your DMs are open, or DM me `!poll` directly.",
      });
    }
  } else {
    // Command used in DMs — start the flow here, guild will be asked later
    createSession(userId);

    await client.api.channels.createMessage(message.channel_id, {
      content:
        "**Let's create a poll!**\n\n" +
        "What is your poll question/text?\n\n" +
        "Type **cancel** at any time to cancel.",
    });
  }
};

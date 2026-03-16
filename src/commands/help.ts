import type { Command } from "../types/command.js";

export const name: Command["name"] = "help";

export const execute: Command["execute"] = async (
  client,
  message,
): Promise<void> => {
  const helpText =
    "**Throat Bot Commands**\n" +
    "`!help` — Show this help message. Can be used in a server channel or DM.\n\n" +
    "`!ping` — Check if the bot is online. Can be used in a server channel or DM.\n\n" +
    "`!poll` — Start creating a poll. Send this command via DM to the bot, or use it in a server channel and the bot will DM you to walk through the setup.\n\n" +
    "`!remindme <time> <message>` — Set a reminder. The `<time>` field accepts units like `s` (seconds), `m` (minutes), `h` (hours), `d` (days), and `w` (weeks). You can combine them together.\n" +
    "> `!remindme list` — View your active reminders.\n" +
    "> `!remindme cancel <id>` — Cancel a reminder by its ID (shown when created or in `!remindme list`).\n" +
    "> **Examples:**\n" +
    "> `!remindme 30m take out the trash` — 30 minutes\n" +
    "> `!remindme 2h check the oven` — 2 hours\n" +
    "> `!remindme 1d12h submit report` — 1 day and 12 hours\n" +
    "> `!remindme 1w review PR` — 1 week\n\n" +
    "`!insult` — Generate a random insult. Can be used in a server channel or DM.\n\n" +
    "`!pasta` — Post a random copypasta from Reddit. Can be used in a server channel or DM.\n\n" +
    "`!purge <number>` — Delete the specified number of messages from the channel (max 100). Server only.\n\n" +
    "`!coinflip` — Flip a coin. Can be used in a server channel or DM.\n\n" +
    "`!blackjack` — Play a game of blackjack against the dealer. Use `!hit` to draw a card and `!stand` to hold. Can be used in a server channel or DM.\n" +
    "> `!blackjack standing` — View your blackjack win/loss record.\n\n";
  await client.api.channels.createMessage(message.channel_id, {
    content: helpText,
  });
};

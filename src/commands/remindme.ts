import {
  cancelReminder,
  createReminder,
  getUserReminders,
} from "../data/reminders.js";
import { parseTime } from "../parseTime.js";
import type { Command } from "../types/command.js";

const MAX_DURATION_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
const MAX_MESSAGE_LENGTH = 512;
const MAX_ACTIVE_REMINDERS = 25;

export const name: Command["name"] = "remindme";

export const execute: Command["execute"] = async (
  client,
  message,
  args,
): Promise<void> => {
  const userId = message.author?.id;
  if (!userId) return;

  const subcommand = args[0]?.toLowerCase();

  // ── !remindme list ──
  if (subcommand === "list") {
    const reminders = await getUserReminders(userId);
    if (reminders.length === 0) {
      await client.api.channels.createMessage(message.channel_id, {
        content: "You have no active reminders.",
      });
      return;
    }

    const lines = reminders.map((r, i) => {
      const timestamp = Math.floor(r.remindAt.getTime() / 1000);
      const preview =
        r.message.length > 60 ? `${r.message.slice(0, 57)}...` : r.message;
      return `**${i + 1}.** (ID: ${r.id}) <t:${timestamp}:R> — ${preview}`;
    });

    await client.api.channels.createMessage(message.channel_id, {
      content: `**Your Reminders**\n\n${lines.join("\n")}`,
    });
    return;
  }

  // ── !remindme cancel <id> ──
  if (subcommand === "cancel") {
    const id = Number.parseInt(args[1], 10);
    if (!id || Number.isNaN(id)) {
      await client.api.channels.createMessage(message.channel_id, {
        content:
          "Please provide a valid reminder ID. Use `!remindme list` to see your reminders.",
      });
      return;
    }

    const cancelled = await cancelReminder(id, userId);
    if (!cancelled) {
      await client.api.channels.createMessage(message.channel_id, {
        content: "Reminder not found, already fired, or you don't own it.",
      });
      return;
    }

    await client.api.channels.createMessage(message.channel_id, {
      content: `Reminder **#${id}** has been cancelled.`,
    });
    return;
  }

  // ── !remindme <time> <message> ──
  if (args.length === 0) {
    await client.api.channels.createMessage(message.channel_id, {
      content:
        "**Usage:**\n" +
        "`!remindme <time> <message>` — Set a reminder\n" +
        "`!remindme list` — View your active reminders\n" +
        "`!remindme cancel <id>` — Cancel a reminder\n\n" +
        "**Time examples:** `30m`, `2h`, `1d12h`, `1w`, `2 hours 30 minutes`",
    });
    return;
  }

  // Try to parse time from the beginning of the args
  const durationMs = parseTime(args.join(" "));
  if (!durationMs) {
    await client.api.channels.createMessage(message.channel_id, {
      content:
        "I couldn't understand that time format.\n" +
        "**Examples:** `30m`, `2h`, `1d12h`, `1w`, `2 hours 30 minutes`",
    });
    return;
  }

  if (durationMs < 30_000) {
    await client.api.channels.createMessage(message.channel_id, {
      content: "Reminders must be at least **30 seconds** in the future.",
    });
    return;
  }

  if (durationMs > MAX_DURATION_MS) {
    await client.api.channels.createMessage(message.channel_id, {
      content: "Reminders cannot be more than **1 year** in the future.",
    });
    return;
  }

  // Extract the message part (everything after the time tokens)
  const timeTokenRegex =
    /(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hrs?|hours?|d|days?|w|weeks?)/gi;
  const reminderMessage =
    args.join(" ").replace(timeTokenRegex, "").trim() || "No message set";

  if (reminderMessage.length > MAX_MESSAGE_LENGTH) {
    await client.api.channels.createMessage(message.channel_id, {
      content: `Reminder message is too long (max ${MAX_MESSAGE_LENGTH} characters).`,
    });
    return;
  }

  // Check active reminder limit
  const existing = await getUserReminders(userId);
  if (existing.length >= MAX_ACTIVE_REMINDERS) {
    await client.api.channels.createMessage(message.channel_id, {
      content: `You have too many active reminders (max ${MAX_ACTIVE_REMINDERS}). Cancel some first with \`!remindme cancel <id>\`.`,
    });
    return;
  }

  const remindAt = new Date(Date.now() + durationMs);
  const reminder = await createReminder({
    userId,
    channelId: message.channel_id,
    guildId: message.guild_id ?? undefined,
    message: reminderMessage,
    remindAt,
  });

  const timestamp = Math.floor(remindAt.getTime() / 1000);
  await client.api.channels.createMessage(message.channel_id, {
    content:
      `Got it! I'll remind you <t:${timestamp}:R> (<t:${timestamp}:f>).\n` +
      `**Message:** ${reminderMessage}\n` +
      `**ID:** ${reminder.id}`,
  });
};

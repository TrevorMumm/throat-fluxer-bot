import type { Client } from "@discordjs/core";
import { getDueReminders, markReminderFired } from "./data/reminders.js";

const POLL_INTERVAL_MS = 15_000; // Check every 15 seconds

let intervalId: ReturnType<typeof setInterval> | null = null;

async function processDueReminders(client: Client): Promise<void> {
  try {
    const reminders = await getDueReminders();

    for (const reminder of reminders) {
      try {
        // Try to DM the user first
        const dmChannel = await client.api.users.createDM(reminder.userId);
        const dm = dmChannel as { id: string };

        const channelLink = reminder.guildId
          ? `\n**From:** <#${reminder.channelId}>`
          : "";

        await client.api.channels.createMessage(dm.id, {
          content:
            `**Reminder!** You asked me to remind you:\n\n` +
            `> ${reminder.message}${channelLink}`,
        });
      } catch {
        // If DM fails, try to send in the original channel
        try {
          await client.api.channels.createMessage(reminder.channelId, {
            content: `<@${reminder.userId}> **Reminder:**\n\n> ${reminder.message}`,
            allowed_mentions: { users: [reminder.userId] },
          });
        } catch (channelError) {
          console.error(
            `Failed to deliver reminder ${reminder.id}:`,
            channelError,
          );
        }
      }

      await markReminderFired(reminder.id);
    }
  } catch (error) {
    console.error("Error processing reminders:", error);
  }
}

export function startReminderScheduler(client: Client): void {
  if (intervalId) return;
  console.log("[reminders] Scheduler started");
  intervalId = setInterval(() => processDueReminders(client), POLL_INTERVAL_MS);
}

export function stopReminderScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[reminders] Scheduler stopped");
  }
}

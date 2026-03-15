import { prisma } from "../db/client.js";

export async function createReminder(input: {
  userId: string;
  channelId: string;
  guildId?: string;
  message: string;
  remindAt: Date;
}) {
  return prisma.reminder.create({ data: input });
}

export async function getDueReminders() {
  return prisma.reminder.findMany({
    where: { fired: false, remindAt: { lte: new Date() } },
    orderBy: { remindAt: "asc" },
  });
}

export async function markReminderFired(id: number) {
  return prisma.reminder.update({
    where: { id },
    data: { fired: true },
  });
}

export async function getUserReminders(userId: string) {
  return prisma.reminder.findMany({
    where: { userId, fired: false },
    orderBy: { remindAt: "asc" },
  });
}

export async function cancelReminder(id: number, userId: string) {
  const reminder = await prisma.reminder.findUnique({ where: { id } });
  if (!reminder || reminder.userId !== userId || reminder.fired) return null;
  return prisma.reminder.update({
    where: { id },
    data: { fired: true },
  });
}

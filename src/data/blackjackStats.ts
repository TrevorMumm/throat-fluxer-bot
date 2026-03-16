import { prisma } from "../db/client.js";

export type GameResult = "win" | "loss" | "push";

export async function recordBlackjackResult(
  userId: string,
  result: GameResult,
): Promise<void> {
  const increment =
    result === "win"
      ? { wins: 1 }
      : result === "loss"
        ? { losses: 1 }
        : { pushes: 1 };

  await prisma.blackjackStats.upsert({
    where: { userId },
    create: { userId, ...increment },
    update: { ...Object.fromEntries(Object.entries(increment).map(([k, v]) => [k, { increment: v }])) },
  });
}

export async function getBlackjackStats(userId: string) {
  return prisma.blackjackStats.findUnique({ where: { userId } });
}

import { prisma } from "../db/client.js";

export async function createPoll(input: {
  question: string;
  options: string[];
  guildId: string;
  channelId: string;
  messageId?: string;
  creatorId: string;
}) {
  return prisma.poll.create({ data: input });
}

export async function setPollMessageId(pollId: string, messageId: string) {
  return prisma.poll.update({
    where: { id: pollId },
    data: { messageId },
  });
}

export async function getPoll(pollId: string) {
  return prisma.poll.findUnique({
    where: { id: pollId },
    include: { votes: true },
  });
}

export async function upsertVote(
  pollId: string,
  userId: string,
  optionIdx: number,
) {
  return prisma.pollVote.upsert({
    where: { pollId_userId: { pollId, userId } },
    update: { optionIdx },
    create: { pollId, userId, optionIdx },
  });
}

export async function removeVote(
  pollId: string,
  userId: string,
  optionIdx: number,
) {
  return prisma.pollVote.deleteMany({
    where: { pollId, userId, optionIdx },
  });
}

export async function getVoteCounts(pollId: string, optionCount: number) {
  const votes = await prisma.pollVote.findMany({ where: { pollId } });
  const counts = new Array<number>(optionCount).fill(0);
  for (const vote of votes) {
    if (vote.optionIdx >= 0 && vote.optionIdx < optionCount) {
      counts[vote.optionIdx]++;
    }
  }
  return { counts, total: votes.length };
}

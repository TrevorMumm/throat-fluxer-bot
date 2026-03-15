import type { BotClient } from "./types/command.js";
import { getPoll, upsertVote, removeVote, getVoteCounts } from "./data/polls.js";
import { buildPollEmbed } from "./pollDmHandler.js";
import { prisma } from "./db/client.js";

const NUMBER_EMOJIS = [
  "1\u20E3", "2\u20E3", "3\u20E3", "4\u20E3", "5\u20E3",
  "6\u20E3", "7\u20E3", "8\u20E3", "9\u20E3", "\uD83D\uDD1F",
];

function emojiToIndex(emoji: string): number {
  return NUMBER_EMOJIS.indexOf(emoji);
}

/**
 * Handles a reaction-add event on a poll message.
 */
export async function handlePollReaction(
  client: BotClient,
  reaction: {
    channel_id: string;
    message_id: string;
    user_id: string;
    emoji: { name?: string; id?: string };
  },
  botId: string | undefined,
): Promise<void> {
  // Ignore the bot's own reactions
  if (botId && reaction.user_id === botId) return;

  const emojiName = reaction.emoji.name;
  if (!emojiName) return;

  const optionIdx = emojiToIndex(emojiName);

  // Look up whether this message is an active poll
  const poll = await prisma.poll.findFirst({
    where: {
      messageId: reaction.message_id,
      active: true,
    },
  });

  if (!poll) return;

  // Remove any reaction that isn't a valid poll option
  if (optionIdx === -1 || optionIdx >= poll.options.length) {
    const emojiStr = reaction.emoji.id
      ? `${emojiName}:${reaction.emoji.id}`
      : emojiName;
    try {
      await client.api.channels.deleteUserMessageReaction(
        reaction.channel_id,
        reaction.message_id,
        encodeURIComponent(emojiStr),
        reaction.user_id,
      );
    } catch (error) {
      console.error("Failed to remove invalid reaction:", error);
    }
    return;
  }

  // Check if the user previously voted for a different option and remove that reaction
  const existingVote = await prisma.pollVote.findUnique({
    where: {
      pollId_userId: { pollId: poll.id, userId: reaction.user_id },
    },
  });

  if (existingVote && existingVote.optionIdx !== optionIdx) {
    // Remove the user's old reaction
    const oldEmoji = NUMBER_EMOJIS[existingVote.optionIdx];
    if (oldEmoji) {
      try {
        await client.api.channels.deleteUserMessageReaction(
          reaction.channel_id,
          reaction.message_id,
          encodeURIComponent(oldEmoji),
          reaction.user_id,
        );
      } catch (error) {
        console.error("Failed to remove old reaction:", error);
      }

      // Re-add the bot's reaction in case it was removed
      try {
        await client.api.channels.addMessageReaction(
          reaction.channel_id,
          reaction.message_id,
          encodeURIComponent(oldEmoji),
        );
      } catch (error) {
        console.error("Failed to re-add bot reaction:", error);
      }
    }
  }

  // Record/update the vote
  await upsertVote(poll.id, reaction.user_id, optionIdx);

  // Get updated vote counts and refresh the embed
  const { counts, total } = await getVoteCounts(poll.id, poll.options.length);
  const embed = buildPollEmbed(poll.question, poll.options, counts, total);

  try {
    await client.api.channels.editMessage(
      reaction.channel_id,
      reaction.message_id,
      { embeds: [embed] as never[] },
    );
  } catch (error) {
    console.error("Failed to update poll embed:", error);
  }

  // Ensure all bot reactions are still present
  await ensureBotReactions(client, reaction.channel_id, reaction.message_id, poll.options.length);
}

/**
 * Handles a reaction-remove event on a poll message.
 */
export async function handlePollReactionRemove(
  client: BotClient,
  reaction: {
    channel_id: string;
    message_id: string;
    user_id: string;
    emoji: { name?: string; id?: string };
  },
  botId: string | undefined,
): Promise<void> {
  if (botId && reaction.user_id === botId) return;

  const emojiName = reaction.emoji.name;
  if (!emojiName) return;

  const optionIdx = emojiToIndex(emojiName);
  if (optionIdx === -1) return;

  const poll = await prisma.poll.findFirst({
    where: {
      messageId: reaction.message_id,
      active: true,
    },
  });

  if (!poll) return;
  if (optionIdx >= poll.options.length) return;

  // Remove the vote for this specific option
  await removeVote(poll.id, reaction.user_id, optionIdx);

  // Refresh the embed
  const { counts, total } = await getVoteCounts(poll.id, poll.options.length);
  const embed = buildPollEmbed(poll.question, poll.options, counts, total);

  try {
    await client.api.channels.editMessage(
      reaction.channel_id,
      reaction.message_id,
      { embeds: [embed] as never[] },
    );
  } catch (error) {
    console.error("Failed to update poll embed:", error);
  }
}

async function ensureBotReactions(
  client: BotClient,
  channelId: string,
  messageId: string,
  optionCount: number,
): Promise<void> {
  for (let i = 0; i < optionCount; i++) {
    const emoji = NUMBER_EMOJIS[i];
    if (emoji) {
      try {
        await client.api.channels.addMessageReaction(
          channelId,
          messageId,
          encodeURIComponent(emoji),
        );
      } catch {
        // Already present or failed — either way, move on
      }
    }
  }
}

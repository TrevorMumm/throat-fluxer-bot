import {
  createGame,
  deleteGame,
  formatGameStatus,
  getGame,
  handValue,
} from "../blackjackSession.js";
import {
  getBlackjackStats,
  recordBlackjackResult,
} from "../data/blackjackStats.js";
import type { Command } from "../types/command.js";

export const name: Command["name"] = "blackjack";
/**
 * Starts a game of blackjack or view standings.
 * Usage: !blackjack / !blackjack standing
 * Use !hit to draw a card, !stand to end your turn.
 * @param client
 * @param message
 */
export const execute: Command["execute"] = async (
  client,
  message,
  args,
): Promise<void> => {
  const userId = message.author?.id;
  if (!userId) return;

  // Handle !blackjack standing
  if (["standing", "standings"].includes(args[0]?.toLowerCase())) {
    const stats = await getBlackjackStats(userId);
    if (!stats || (stats.wins === 0 && stats.losses === 0 && stats.pushes === 0)) {
      await client.api.channels.createMessage(message.channel_id, {
        content: "You haven't played any blackjack games yet! Use `!blackjack` to start.",
      });
      return;
    }

    const total = stats.wins + stats.losses + stats.pushes;
    const winRate = ((stats.wins / total) * 100).toFixed(1);

    await client.api.channels.createMessage(message.channel_id, {
      content:
        `🃏 **Blackjack Standing**\n\n` +
        `**Games Played:** ${total}\n` +
        `**Wins:** ${stats.wins}\n` +
        `**Losses:** ${stats.losses}\n` +
        `**Pushes:** ${stats.pushes}\n` +
        `**Win Rate:** ${winRate}%`,
    });
    return;
  }

  const existing = getGame(userId, message.channel_id);
  if (existing) {
    await client.api.channels.createMessage(message.channel_id, {
      content:
        "You already have a game in progress! Use `!hit` or `!stand` to continue.",
    });
    return;
  }

  const game = createGame(userId, message.channel_id);
  const playerVal = handValue(game.playerHand);

  // Check for natural blackjack
  if (playerVal === 21) {
    const dealerVal = handValue(game.dealerHand);
    deleteGame(userId, message.channel_id);

    if (dealerVal === 21) {
      await recordBlackjackResult(userId, "push");
      await client.api.channels.createMessage(message.channel_id, {
        content:
          `🃏 **Blackjack**\n\n${formatGameStatus(game, true)}\n\n` +
          "Push! Dealer also has blackjack. 🤝",
      });
    } else {
      await recordBlackjackResult(userId, "win");
      await client.api.channels.createMessage(message.channel_id, {
        content:
          `🃏 **Blackjack**\n\n${formatGameStatus(game, true)}\n\n` +
          "**Blackjack!** You win! 🎉",
      });
    }
    return;
  }

  await client.api.channels.createMessage(message.channel_id, {
    content:
      `🃏 **Blackjack**\n\n${formatGameStatus(game, false)}\n\n` +
      "Type `!hit` to draw or `!stand` to hold.",
  });
};

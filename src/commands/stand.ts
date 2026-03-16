import {
  deleteGame,
  formatGameStatus,
  getGame,
  handValue,
} from "../blackjackSession.js";
import { recordBlackjackResult } from "../data/blackjackStats.js";
import type { Command } from "../types/command.js";

export const name: Command["name"] = "stand";
/**
 * Ends your turn in an active blackjack game. The dealer draws until 17+.
 * Usage: !stand
 * @param client
 * @param message
 */
export const execute: Command["execute"] = async (
  client,
  message,
): Promise<void> => {
  const userId = message.author?.id;
  if (!userId) return;

  const game = getGame(userId, message.channel_id);
  if (!game) {
    await client.api.channels.createMessage(message.channel_id, {
      content: "You don't have an active blackjack game. Use `!blackjack` to start one.",
    });
    return;
  }

  // Dealer draws until 17 or higher
  const { dealerHand, deck } = game;
  while (handValue(dealerHand) < 17) {
    dealerHand.push(deck.pop()!);
  }

  const playerVal = handValue(game.playerHand);
  const dealerVal = handValue(dealerHand);
  deleteGame(userId, message.channel_id);

  let result: string;
  if (dealerVal > 21) {
    result = "Dealer busts! **You win!** 🎉";
    await recordBlackjackResult(userId, "win");
  } else if (playerVal > dealerVal) {
    result = "**You win!** 🎉";
    await recordBlackjackResult(userId, "win");
  } else if (playerVal < dealerVal) {
    result = "**Dealer wins.** 😞";
    await recordBlackjackResult(userId, "loss");
  } else {
    result = "**Push!** It's a tie. 🤝";
    await recordBlackjackResult(userId, "push");
  }

  await client.api.channels.createMessage(message.channel_id, {
    content: `🃏 **Blackjack**\n\n${formatGameStatus(game, true)}\n\n${result}`,
  });
};

import {
  deleteGame,
  drawCard,
  formatGameStatus,
  getGame,
  handValue,
} from "../blackjackSession.js";
import { recordBlackjackResult } from "../data/blackjackStats.js";
import type { Command } from "../types/command.js";

export const name: Command["name"] = "hit";
/**
 * Draws a card in an active blackjack game.
 * Usage: !hit
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

  game.playerHand.push(drawCard(game));
  const playerVal = handValue(game.playerHand);

  if (playerVal > 21) {
    deleteGame(userId, message.channel_id);
    await recordBlackjackResult(userId, "loss");
    await client.api.channels.createMessage(message.channel_id, {
      content:
        `🃏 **Blackjack**\n\n${formatGameStatus(game, true)}\n\n` +
        "**Bust!** You went over 21. Dealer wins. 💥",
    });
    return;
  }

  if (playerVal === 21) {
    // Auto-stand on 21
    const { dealerHand, deck } = game;
    while (handValue(dealerHand) < 17) {
      dealerHand.push(deck.pop()!);
    }
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
    return;
  }

  await client.api.channels.createMessage(message.channel_id, {
    content:
      `🃏 **Blackjack**\n\n${formatGameStatus(game, false)}\n\n` +
      "Type `!hit` to draw or `!stand` to hold.",
  });
};

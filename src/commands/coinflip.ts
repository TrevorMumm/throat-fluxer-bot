import type { Command } from "../types/command.js";

export const name: Command["name"] = "coinflip";
/**
 * Flips a coin and responds with the result.
 * Usage: !coinflip
 * @param client
 * @param message
 */
export const execute: Command["execute"] = async (
  client,
  message,
): Promise<void> => {
  const isHeads = Math.random() < 0.5;
  const emoji = isHeads ? "🤯" : "🪙";
  const result = isHeads ? "Heads" : "Tails";
  await client.api.channels.createMessage(message.channel_id, {
    content: `${emoji} ${result}!`,
  });
};

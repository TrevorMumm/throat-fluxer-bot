import { INSTANCE_ID } from "../config.js";
import { getAllSyncConfigs, getSyncChannelMaps } from "../data/sync.js";
import { isSyncEngineStopped } from "../syncEngine.js";
import type { Command } from "../types/command.js";

// Hidden command — not listed in !help
export const name: Command["name"] = "syncstatus";

export const execute: Command["execute"] = async (
  client,
  message,
): Promise<void> => {
  if (!INSTANCE_ID) {
    await client.api.channels.createMessage(message.channel_id, {
      content: "Sync is not configured on this instance.",
    });
    return;
  }

  const configs = await getAllSyncConfigs();

  if (configs.length === 0) {
    await client.api.channels.createMessage(message.channel_id, {
      content: "No sync configurations found. Use `!sync` to set one up.",
    });
    return;
  }

  const engineStatus = isSyncEngineStopped() ? "🛑 HALTED" : "✅ Running";

  const lines: string[] = [
    `**Sync Status** (Instance ${INSTANCE_ID})`,
    `Engine: ${engineStatus}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    "",
  ];

  for (const config of configs) {
    const statusIcon =
      config.status === "active"
        ? "🟢"
        : config.status === "initial_sync"
          ? "🔄"
          : config.status === "stopped"
            ? "🔴"
            : "⏸️";

    const channelMaps = await getSyncChannelMaps(config.id);

    lines.push(
      `${statusIcon} **${config.guildNameA}** ↔ **${config.guildNameB}**`,
      `  Status: **${config.status}** | Master: Instance ${config.masterInstance}`,
      `  Channels synced: ${channelMaps.length}`,
      `  Created: ${config.createdAt.toISOString().split("T")[0]}`,
      "",
    );
  }

  await client.api.channels.createMessage(message.channel_id, {
    content: lines.join("\n"),
    allowed_mentions: { parse: [] },
  });
};

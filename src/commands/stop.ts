import {
  getActiveSyncConfigs,
  stopAllSyncs,
  updateSyncConfigStatus,
} from "../data/sync.js";
import type { Command } from "../types/command.js";

// Emergency halt — works in any channel or DM on either bot
export const name: Command["name"] = "stop";

export const execute: Command["execute"] = async (
  client,
  message,
  args,
): Promise<void> => {
  try {
    // !stop all — nuclear option, stop everything
    if (args[0]?.toLowerCase() === "all") {
      await stopAllSyncs();
      await client.api.channels.createMessage(message.channel_id, {
        content:
          "🛑 **ALL SYNCS STOPPED** — Emergency halt triggered.\n" +
          "All sync operations have been flagged to stop immediately.\n" +
          "Both bot instances will halt sync on their next poll cycle.",
      });
      return;
    }

    // !stop <number> — stop a specific sync by its list index
    const idx = Number.parseInt(args[0] ?? "", 10);
    if (!Number.isNaN(idx) && idx > 0) {
      const configs = await getActiveSyncConfigs();
      const target = configs[idx - 1];
      if (!target) {
        await client.api.channels.createMessage(message.channel_id, {
          content: `Invalid selection. There are ${configs.length} active sync(s). Use \`!stop\` to see the list.`,
        });
        return;
      }

      await updateSyncConfigStatus(target.id, "stopped");
      await client.api.channels.createMessage(message.channel_id, {
        content:
          `🛑 **Sync stopped:** **${target.guildNameA}** ↔ **${target.guildNameB}**\n` +
          `This sync pair will no longer relay messages.`,
      });
      return;
    }

    // !stop (no args) — list active syncs and show usage
    const configs = await getActiveSyncConfigs();

    if (configs.length === 0) {
      await client.api.channels.createMessage(message.channel_id, {
        content: "No active syncs running.",
      });
      return;
    }

    const lines: string[] = ["**Active Syncs**", "━━━━━━━━━━━━━━━━━━━━", ""];

    for (let i = 0; i < configs.length; i++) {
      const c = configs[i];
      const statusIcon = c.status === "initial_sync" ? "🔄" : "🟢";
      lines.push(
        `**${i + 1}.** ${statusIcon} **${c.guildNameA}** ↔ **${c.guildNameB}** (${c.status})`,
      );
    }

    lines.push(
      "",
      "**Usage:**",
      `\`!stop <number>\` — Stop a specific sync`,
      `\`!stop all\` — Emergency halt all syncs`,
    );

    await client.api.channels.createMessage(message.channel_id, {
      content: lines.join("\n"),
      allowed_mentions: { parse: [] },
    });
  } catch (error) {
    console.error("[sync] Failed to process stop:", error);
    await client.api.channels.createMessage(message.channel_id, {
      content: "Failed to process stop command. Check logs for details.",
    });
  }
};

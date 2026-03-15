import { createPoll, setPollMessageId } from "./data/polls.js";
import { deleteSession, getSession, updateSession } from "./pollSession.js";
import type { BotClient, MessageCreatePayload } from "./types/command.js";

// ── Number emojis for reaction-based voting ─────────────────────────

const NUMBER_EMOJIS = [
  "1\u20E3",
  "2\u20E3",
  "3\u20E3",
  "4\u20E3",
  "5\u20E3",
  "6\u20E3",
  "7\u20E3",
  "8\u20E3",
  "9\u20E3",
  "\uD83D\uDD1F",
];

// ── Embed builders ──────────────────────────────────────────────────

export function buildPollEmbed(
  question: string,
  options: string[],
  counts?: number[],
  total?: number,
) {
  const totalVotes = total ?? 0;
  const lines = options.map((opt, i) => {
    const emoji = NUMBER_EMOJIS[i] ?? `${i + 1}.`;
    if (counts && totalVotes > 0) {
      const count = counts[i] ?? 0;
      const pct = (count / totalVotes) * 100;
      const filled = Math.round(pct / 5);
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(20 - filled);
      return `${emoji}  **${opt}**\n${bar}  ${pct.toFixed(1)}% (${count} vote${count !== 1 ? "s" : ""})`;
    }
    return `${emoji}  **${opt}**`;
  });

  const footer =
    totalVotes > 0
      ? `\n\n*Total votes: ${totalVotes}*`
      : "\n\n*Vote by reacting!*";

  return {
    title: `\uD83D\uDCCA  ${question}`,
    description: lines.join("\n\n") + footer,
    color: 0x5865f2,
  };
}

// ── DM conversation handler ─────────────────────────────────────────

export async function handlePollDM(
  client: BotClient,
  message: MessageCreatePayload,
): Promise<void> {
  const userId = message.author?.id;
  if (!userId) return;

  const session = getSession(userId);
  if (!session) return;

  const text = message.content.trim();
  const channelId = message.channel_id;

  // ── Global cancel check (works at every step) ──
  if (text.toLowerCase() === "cancel") {
    deleteSession(userId);
    await client.api.channels.createMessage(channelId, {
      content: "Poll creation cancelled.",
    });
    return;
  }

  switch (session.state) {
    // ── Step 1: collect question ──
    case "awaiting_question":
    case "editing_question": {
      updateSession(userId, { question: text, state: "awaiting_options" });
      await client.api.channels.createMessage(channelId, {
        content:
          `Your poll question:\n> **${text}**\n\n` +
          "Now enter the poll options, separated by commas.\n" +
          "Example: `Cats, Dogs, Monkeys`\n\n" +
          "Type **cancel** at any time to cancel.",
      });
      break;
    }

    // ── Step 2: collect options ──
    case "awaiting_options":
    case "editing_options": {
      const options = text
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean);

      if (options.length < 2) {
        await client.api.channels.createMessage(channelId, {
          content:
            "You need at least **2** options. Please try again, separated by commas.",
        });
        return;
      }
      if (options.length > 10) {
        await client.api.channels.createMessage(channelId, {
          content:
            "Maximum of **10** options allowed (one per reaction emoji). Please try again with fewer options.",
        });
        return;
      }

      updateSession(userId, { options, state: "preview" });

      // Show a preview embed
      const embed = buildPollEmbed(session.question!, options);

      await client.api.channels.createMessage(channelId, {
        content: "Here's a preview of your poll:",
        embeds: [embed] as never[],
      });

      await client.api.channels.createMessage(channelId, {
        content:
          "Does this look good?\n" +
          "- Type **yes** to continue and select server channel\n" +
          "- Type **1** to edit the poll title\n" +
          "- Type **2** to edit the options\n" +
          "- Type **3** to cancel",
      });
      break;
    }

    // ── Step 3: confirm or edit ──
    case "preview": {
      const lower = text.toLowerCase();

      if (lower === "1") {
        updateSession(userId, { state: "editing_question" });
        await client.api.channels.createMessage(channelId, {
          content: "Enter the new poll question/text, or **cancel** to cancel:",
        });
        return;
      }

      if (lower === "2") {
        updateSession(userId, { state: "editing_options" });
        await client.api.channels.createMessage(channelId, {
          content:
            "Enter the new poll options, separated by commas, or **cancel** to cancel:",
        });
        return;
      }

      if (lower === "3" || lower === "cancel") {
        deleteSession(userId);
        await client.api.channels.createMessage(channelId, {
          content: "Poll creation cancelled.",
        });
        return;
      }

      if (lower === "yes" || lower === "y") {
        // If we already know the guild, skip to channel selection
        if (session.guildId) {
          updateSession(userId, { state: "awaiting_channel" });
          await promptChannelSelection(client, channelId, session.guildId);
        } else {
          // Need to figure out which guild — list the bot's guilds
          updateSession(userId, { state: "awaiting_guild" });
          await promptGuildSelection(client, channelId, userId);
        }
        return;
      }

      await client.api.channels.createMessage(channelId, {
        content:
          "Please type **yes** to post, **1** to edit the title, **2** to edit the options, or **3** to cancel.",
      });
      break;
    }

    // ── Step 3b: pick guild ──
    case "awaiting_guild": {
      try {
        const guilds = (await client.api.users.getGuilds()) as unknown as {
          id: string;
          name: string;
        }[];
        const idx = Number.parseInt(text, 10) - 1;
        if (Number.isNaN(idx) || idx < 0 || idx >= guilds.length) {
          await client.api.channels.createMessage(channelId, {
            content:
              "Invalid selection. Please enter the number of the server.",
          });
          return;
        }
        const guild = guilds[idx];
        updateSession(userId, { guildId: guild.id, state: "awaiting_channel" });
        await promptChannelSelection(client, channelId, guild.id);
      } catch (error) {
        console.error("Failed to list guilds:", error);
        await client.api.channels.createMessage(channelId, {
          content: "Something went wrong fetching servers. Please try again.",
        });
      }
      break;
    }

    // ── Step 4: pick channel ──
    case "awaiting_channel": {
      try {
        const channels = (await client.api.guilds.getChannels(
          session.guildId!,
        )) as unknown as { id: string; name: string; type: number }[];
        const textChannels = channels.filter((c) => c.type === 0);
        const idx = Number.parseInt(text, 10) - 1;

        if (Number.isNaN(idx) || idx < 0 || idx >= textChannels.length) {
          await client.api.channels.createMessage(channelId, {
            content:
              "Invalid selection. Please enter the number of the channel.",
          });
          return;
        }

        const target = textChannels[idx];
        await postPoll(client, userId, channelId, target.id, session);
      } catch (error) {
        console.error("Failed to post poll:", error);
        await client.api.channels.createMessage(channelId, {
          content: "Something went wrong posting the poll. Please try again.",
        });
      }
      break;
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

async function promptGuildSelection(
  client: BotClient,
  dmChannelId: string,
  userId?: string,
) {
  try {
    const guilds = (await client.api.users.getGuilds()) as unknown as {
      id: string;
      name: string;
    }[];
    if (guilds.length === 0) {
      await client.api.channels.createMessage(dmChannelId, {
        content: "I'm not in any servers! Invite me to a server first.",
      });
      return;
    }
    if (guilds.length === 1 && userId) {
      // Auto-select the only guild
      const guild = guilds[0];
      updateSession(userId, { guildId: guild.id, state: "awaiting_channel" });
      await promptChannelSelection(client, dmChannelId, guild.id);
      return;
    }
    const list = guilds
      .map((g, i: number) => `**${i + 1}.** ${g.name}`)
      .join("\n");
    await client.api.channels.createMessage(dmChannelId, {
      content: `Which server should I post this poll in?\n\n${list}\n\nType the number of the server, or **cancel** to cancel.`,
    });
  } catch (error) {
    console.error("Failed to list guilds:", error);
    await client.api.channels.createMessage(dmChannelId, {
      content: "Something went wrong fetching servers. Please try again.",
    });
  }
}

async function promptChannelSelection(
  client: BotClient,
  dmChannelId: string,
  guildId: string,
) {
  try {
    const channels = (await client.api.guilds.getChannels(
      guildId,
    )) as unknown as { id: string; name: string; type: number }[];
    const textChannels = channels.filter((c) => c.type === 0);

    if (textChannels.length === 0) {
      await client.api.channels.createMessage(dmChannelId, {
        content: "I couldn't find any text channels in that server.",
      });
      return;
    }

    const list = textChannels
      .map((c, i: number) => `**${i + 1}.** #${c.name}`)
      .join("\n");

    await client.api.channels.createMessage(dmChannelId, {
      content: `Which channel should I post the poll in?\n\n${list}\n\nType the number of the channel, or **cancel** to cancel.`,
    });
  } catch (error) {
    console.error("Failed to list channels:", error);
    await client.api.channels.createMessage(dmChannelId, {
      content: "Something went wrong fetching channels. Please try again.",
    });
  }
}

async function postPoll(
  client: BotClient,
  userId: string,
  dmChannelId: string,
  targetChannelId: string,
  session: { question?: string; options?: string[]; guildId?: string },
) {
  const question = session.question!;
  const options = session.options!;
  const guildId = session.guildId!;

  // Save to database
  const poll = await createPoll({
    question,
    options,
    guildId,
    channelId: targetChannelId,
    creatorId: userId,
  });

  // Post the poll message (embed only, no components)
  const embed = buildPollEmbed(question, options);

  const posted = (await client.api.channels.createMessage(targetChannelId, {
    embeds: [embed] as never[],
  })) as unknown as { id: string };

  // Store the message ID so we can update it later on votes
  if (posted?.id) {
    await setPollMessageId(poll.id, posted.id);

    // Add numbered reaction emojis for voting
    for (let i = 0; i < options.length; i++) {
      const emoji = NUMBER_EMOJIS[i];
      if (emoji) {
        try {
          await client.api.channels.addMessageReaction(
            targetChannelId,
            posted.id,
            encodeURIComponent(emoji),
          );
        } catch (error) {
          console.error(`Failed to add reaction ${emoji}:`, error);
        }
      }
    }
  }

  deleteSession(userId);

  await client.api.channels.createMessage(dmChannelId, {
    content: `Your poll has been posted! Check <#${targetChannelId}> to see it.`,
  });
}

import type { Command } from "../types/command.js";

const DISCORD_MAX_LENGTH = 2000;
const TARGET_POST_COUNT = 1000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REDDIT_HEADERS = { "User-Agent": "fluxer-bot:1.0 (discord bot)" };

type RedditPost = { title: string; selftext: string };
type RedditListing = {
  data: { children: { data: RedditPost }[]; after: string | null };
};

let cachedPosts: RedditPost[] = [];
let cacheTimestamp = 0;

async function fetchTopPosts(): Promise<RedditPost[]> {
  const posts: RedditPost[] = [];
  let after: string | null = null;

  while (posts.length < TARGET_POST_COUNT) {
    const url = `https://www.reddit.com/r/copypasta/top.json?t=all&limit=100${after ? `&after=${after}` : ""}`;
    const response = await fetch(url, {
      headers: REDDIT_HEADERS,
      redirect: "follow",
    });

    if (!response.ok) break;

    const json = (await response.json()) as RedditListing;
    const children = json.data.children;

    for (const child of children) {
      if (child.data.selftext) {
        posts.push({ title: child.data.title, selftext: child.data.selftext });
      }
    }

    after = json.data.after;
    if (!after) break;
  }

  return posts;
}

async function getTopPosts(): Promise<RedditPost[]> {
  if (cachedPosts.length > 0 && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPosts;
  }

  const posts = await fetchTopPosts();
  if (posts.length > 0) {
    cachedPosts = posts;
    cacheTimestamp = Date.now();
  }
  return cachedPosts;
}

export const name: Command["name"] = "pasta";

export const execute: Command["execute"] = async (
  client,
  message,
): Promise<void> => {
  try {
    const posts = await getTopPosts();

    if (posts.length === 0) {
      await client.api.channels.createMessage(message.channel_id, {
        content: "Failed to fetch copypastas. Try again later!",
      });
      return;
    }

    const post = posts[Math.floor(Math.random() * posts.length)];

    const full = `**${post.title}**\n\n${post.selftext}`;
    const content =
      full.length > DISCORD_MAX_LENGTH
        ? `${full.slice(0, DISCORD_MAX_LENGTH - 3)}...`
        : full;

    await client.api.channels.createMessage(message.channel_id, {
      content,
    });

    try {
      await client.api.channels.deleteMessage(message.channel_id, message.id);
    } catch {
      // Bot may lack Manage Messages permission — silently ignore
    }
  } catch {
    await client.api.channels.createMessage(message.channel_id, {
      content: "Something went wrong fetching a copypasta. Try again later!",
    });
  }
};

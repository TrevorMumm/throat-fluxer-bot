import dotenv from "dotenv";

dotenv.config();

export const API_BASE_URL =
  process.env.API_BASE_URL || "http://localhost:49319/api";
export const API_VERSION = "1";
export const GATEWAY_VERSION = "1";

export const BOT_TOKEN = process.env.FLUXER_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error(
    "Missing FLUXER_BOT_TOKEN. Set it in your environment or .env file.",
  );
  process.exit(1);
}

// ── Sync feature config ─────────────────────────────────────────────
export const INSTANCE_ID = process.env.INSTANCE_ID || ""; // "A" or "B"
export const PEER_API_BASE_URL = process.env.PEER_API_BASE_URL || "";
export const PEER_BOT_TOKEN = process.env.PEER_BOT_TOKEN || "";
export const SYNC_POLL_INTERVAL_MS = Number.parseInt(
  process.env.SYNC_POLL_INTERVAL_MS ?? "3000",
  10,
);

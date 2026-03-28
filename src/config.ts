import dotenv from "dotenv";

dotenv.config();

// ── API connection (this instance) ──────────────────────────────────
export const API_BASE_URL = process.env.API_BASE_URL || "";
export const API_VERSION = process.env.API_VERSION || "1";
export const GATEWAY_VERSION = process.env.GATEWAY_VERSION || "1";
export const GATEWAY_INTENTS = Number.parseInt(
  process.env.GATEWAY_INTENTS ?? "0",
  10,
);

/** True when this instance connects to Discord rather than Fluxer. */
export const IS_DISCORD = API_VERSION !== "1";

export const BOT_TOKEN =
  process.env.DISCORD_BOT_TOKEN || process.env.FLUXER_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error(
    "Missing bot token. Set DISCORD_BOT_TOKEN or FLUXER_BOT_TOKEN in your environment or .env file.",
  );
  process.exit(1);
}

// ── Sync feature config ─────────────────────────────────────────────
export const INSTANCE_ID = process.env.INSTANCE_ID || ""; // "A", "B", or "C"
export const SYNC_POLL_INTERVAL_MS = Number.parseInt(
  process.env.SYNC_POLL_INTERVAL_MS ?? "3000",
  10,
);

// ── Multi-peer config ───────────────────────────────────────────────
// Each peer is configured via PEER_<ID>_API_BASE_URL and PEER_<ID>_BOT_TOKEN.
// Backward-compat: PEER_API_BASE_URL / PEER_BOT_TOKEN map to the "other" instance.

export interface PeerConfig {
  apiBaseUrl: string;
  botToken: string;
  apiVersion: string;
}

export const PEERS = new Map<string, PeerConfig>();

// New-style: PEER_A_*, PEER_B_*, PEER_C_*
for (const id of ["A", "B", "C"]) {
  if (id === INSTANCE_ID) continue;
  const url = process.env[`PEER_${id}_API_BASE_URL`];
  const token = process.env[`PEER_${id}_BOT_TOKEN`];
  const version = process.env[`PEER_${id}_API_VERSION`] || "1";
  if (url && token) {
    PEERS.set(id, { apiBaseUrl: url, botToken: token, apiVersion: version });
  }
}

// Backward-compat: old PEER_API_BASE_URL / PEER_BOT_TOKEN
if (PEERS.size === 0) {
  const url = process.env.PEER_API_BASE_URL;
  const token = process.env.PEER_BOT_TOKEN;
  if (url && token) {
    // Infer the peer instance from our own ID
    const peerId = INSTANCE_ID === "A" ? "B" : "A";
    PEERS.set(peerId, { apiBaseUrl: url, botToken: token, apiVersion: "1" });
  }
}

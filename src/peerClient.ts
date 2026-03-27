import { REST } from "@discordjs/rest";
import { API_VERSION, PEER_API_BASE_URL, PEER_BOT_TOKEN } from "./config.js";

let peerRest: REST | null = null;

export function getPeerRest(): REST | null {
  if (!PEER_API_BASE_URL || !PEER_BOT_TOKEN) return null;

  if (!peerRest) {
    peerRest = new REST({
      version: API_VERSION,
      api: PEER_API_BASE_URL,
      headers: { "X-Forwarded-For": "127.0.0.1" },
    }).setToken(PEER_BOT_TOKEN);
  }

  return peerRest;
}

export function hasPeerConfig(): boolean {
  return !!PEER_API_BASE_URL && !!PEER_BOT_TOKEN;
}

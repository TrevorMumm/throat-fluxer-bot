import { REST } from "@discordjs/rest";
import { PEERS } from "./config.js";

const peerClients = new Map<string, REST>();

/**
 * Get the REST client for a specific peer instance.
 * Returns null if the peer is not configured.
 */
export function getPeerRest(instanceId: string): REST | null {
  const cached = peerClients.get(instanceId);
  if (cached) return cached;

  const config = PEERS.get(instanceId);
  if (!config) return null;

  const isFluxer = config.apiVersion === "1";

  const rest = new REST({
    version: config.apiVersion,
    ...(isFluxer
      ? { api: config.apiBaseUrl, headers: { "X-Forwarded-For": "127.0.0.1" } }
      : {}),
  }).setToken(config.botToken);

  peerClients.set(instanceId, rest);
  return rest;
}

/** Returns all configured peer instance IDs. */
export function getPeerIds(): string[] {
  return [...PEERS.keys()];
}

/** Returns true if at least one peer is configured. */
export function hasPeerConfig(): boolean {
  return PEERS.size > 0;
}

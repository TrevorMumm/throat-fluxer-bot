import { API_BASE_URL, INSTANCE_ID, IS_DISCORD, PEERS } from "./config.js";

const FRIENDLY_NAMES: Record<string, string> = {
  "http://host.docker.internal:49319/api": "Fluxer-VM",
  "https://throat.chat/api": "Throat",
};

function resolveLabel(apiBaseUrl: string, isDiscord: boolean): string {
  if (isDiscord) return "Discord";
  const friendly = FRIENDLY_NAMES[apiBaseUrl];
  if (friendly) return friendly;
  return apiBaseUrl || "local";
}

/**
 * Returns a human-readable label for an instance (e.g. "Fluxer-VM", "Throat", "Discord").
 */
export function instanceLabel(instanceId: string): string {
  if (instanceId === INSTANCE_ID) {
    return resolveLabel(API_BASE_URL, IS_DISCORD);
  }
  const peer = PEERS.get(instanceId);
  if (!peer) return "unknown";
  return resolveLabel(peer.apiBaseUrl, peer.apiVersion !== "1");
}

/**
 * Returns all configured instance IDs (local + peers), sorted.
 */
export function allInstanceIds(): string[] {
  const ids = new Set<string>();
  if (INSTANCE_ID) ids.add(INSTANCE_ID);
  for (const id of PEERS.keys()) ids.add(id);
  return [...ids].sort();
}

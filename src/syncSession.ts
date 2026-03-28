export type SyncSessionState =
  | "awaiting_mode"
  | "awaiting_master_instance"
  | "awaiting_master_guild"
  | "awaiting_second_instance"
  | "awaiting_second_guild"
  | "awaiting_third_instance"
  | "awaiting_third_guild"
  | "confirm"
  | "syncing";

export interface SyncGuildBasic {
  id: string;
  name: string;
}

export interface SyncGuildInfo {
  id: string;
  name: string;
  textChannelCount: number;
  voiceChannelCount: number;
  categoryCount: number;
}

export interface SyncInstanceSelection {
  instanceId: string;
  guild: SyncGuildInfo;
}

export interface SyncSession {
  state: SyncSessionState;
  mode?: "pair" | "triplet";
  dmChannelId?: string;
  /** Guild lists keyed by instance ID */
  guildLists: Map<string, SyncGuildBasic[]>;
  /** Ordered selections: [0]=master, [1]=second, [2]=third (triplet only) */
  selections: SyncInstanceSelection[];
  createdAt: number;
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const sessions = new Map<string, SyncSession>();

export function getSyncSession(userId: string): SyncSession | undefined {
  const session = sessions.get(userId);
  if (session && Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    sessions.delete(userId);
    return undefined;
  }
  return session;
}

export function createSyncSession(userId: string): SyncSession {
  const session: SyncSession = {
    state: "awaiting_mode",
    guildLists: new Map(),
    selections: [],
    createdAt: Date.now(),
  };
  sessions.set(userId, session);
  return session;
}

export function updateSyncSession(
  userId: string,
  updates: Partial<Omit<SyncSession, "guildLists" | "selections">>,
): SyncSession | undefined {
  const session = getSyncSession(userId);
  if (!session) return undefined;
  Object.assign(session, updates);
  return session;
}

export function deleteSyncSession(userId: string): void {
  sessions.delete(userId);
}

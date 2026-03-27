export type SyncSessionState =
  | "awaiting_guild_a"
  | "awaiting_guild_b"
  | "awaiting_master"
  | "confirm_1"
  | "confirm_2"
  | "confirm_3"
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
  messageEstimate?: number;
}

export interface SyncSession {
  state: SyncSessionState;
  dmChannelId?: string;
  guildsA?: SyncGuildBasic[];
  guildsB?: SyncGuildBasic[];
  guildInfoA?: SyncGuildInfo;
  guildInfoB?: SyncGuildInfo;
  masterInstance?: string;
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
    state: "awaiting_master",
    createdAt: Date.now(),
  };
  sessions.set(userId, session);
  return session;
}

export function updateSyncSession(
  userId: string,
  updates: Partial<SyncSession>,
): SyncSession | undefined {
  const session = getSyncSession(userId);
  if (!session) return undefined;
  Object.assign(session, updates);
  return session;
}

export function deleteSyncSession(userId: string): void {
  sessions.delete(userId);
}

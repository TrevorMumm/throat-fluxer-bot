export type PurgeSessionState = "awaiting_confirmation" | "awaiting_code";

export interface PurgeSession {
  state: PurgeSessionState;
  channelId: string;
  userId: string;
  confirmationCode: string;
  createdAt: number;
}

const SESSION_TIMEOUT_MS = 60 * 1000; // 1 minute to respond

// Keyed by `${userId}:${channelId}` so the same user can only have one purge
// session per channel.
const sessions = new Map<string, PurgeSession>();

function key(userId: string, channelId: string): string {
  return `${userId}:${channelId}`;
}

export function getPurgeSession(
  userId: string,
  channelId: string,
): PurgeSession | undefined {
  const session = sessions.get(key(userId, channelId));
  if (session && Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    sessions.delete(key(userId, channelId));
    return undefined;
  }
  return session;
}

export function createPurgeSession(
  userId: string,
  channelId: string,
): PurgeSession {
  const code = generateCode();
  const session: PurgeSession = {
    state: "awaiting_confirmation",
    channelId,
    userId,
    confirmationCode: code,
    createdAt: Date.now(),
  };
  sessions.set(key(userId, channelId), session);
  return session;
}

export function updatePurgeSession(
  userId: string,
  channelId: string,
  updates: Partial<PurgeSession>,
): PurgeSession | undefined {
  const session = getPurgeSession(userId, channelId);
  if (!session) return undefined;
  Object.assign(session, updates);
  return session;
}

export function deletePurgeSession(
  userId: string,
  channelId: string,
): void {
  sessions.delete(key(userId, channelId));
}

function generateCode(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export type PollSessionState =
  | "awaiting_question"
  | "awaiting_options"
  | "preview"
  | "editing_question"
  | "editing_options"
  | "awaiting_guild"
  | "awaiting_channel";

export interface PollSession {
  state: PollSessionState;
  question?: string;
  options?: string[];
  guildId?: string;
  dmChannelId?: string;
  createdAt: number;
}

const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
const sessions = new Map<string, PollSession>();

export function getSession(userId: string): PollSession | undefined {
  const session = sessions.get(userId);
  if (session && Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    sessions.delete(userId);
    return undefined;
  }
  return session;
}

export function createSession(
  userId: string,
  guildId?: string,
): PollSession {
  const session: PollSession = {
    state: "awaiting_question",
    guildId,
    createdAt: Date.now(),
  };
  sessions.set(userId, session);
  return session;
}

export function updateSession(
  userId: string,
  updates: Partial<PollSession>,
): PollSession | undefined {
  const session = getSession(userId);
  if (!session) return undefined;
  Object.assign(session, updates);
  return session;
}

export function deleteSession(userId: string): void {
  sessions.delete(userId);
}

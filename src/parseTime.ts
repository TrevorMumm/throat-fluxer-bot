const TIME_REGEX =
  /(\d+)\s*(s|sec|seconds?|m|min|minutes?|h|hrs?|hours?|d|days?|w|weeks?)/gi;

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  sec: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
  w: 604800,
  week: 604800,
  weeks: 604800,
};

/**
 * Parses a human-readable duration string and returns the total milliseconds.
 * Supports combined formats like "1d2h30m" or "2 hours 30 minutes".
 * Returns null if no valid time tokens are found.
 */
export function parseTime(input: string): number | null {
  let totalMs = 0;
  let matched = false;

  for (const match of input.matchAll(TIME_REGEX)) {
    const value = Number.parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    const multiplier = UNIT_SECONDS[unit];
    if (multiplier) {
      totalMs += value * multiplier * 1000;
      matched = true;
    }
  }

  return matched ? totalMs : null;
}

/**
 * Returns a human-readable string for a duration in milliseconds.
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const parts: string[] = [];

  const weeks = Math.floor(seconds / 604800);
  const days = Math.floor((seconds % 604800) / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (weeks) parts.push(`${weeks}w`);
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (secs) parts.push(`${secs}s`);

  return parts.join(" ") || "0s";
}

export type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function resolveOwnerTimeZone(): string {
  const configured = process.env.JARVIS_TIMEZONE?.trim() || process.env.TZ?.trim();
  if (configured && isValidTimeZone(configured)) return configured;
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return detected && isValidTimeZone(detected) ? detected : 'UTC';
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function utcToZonedParts(utcMs: number, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(utcMs)).map(part => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/**
 * Convert a wall-clock local datetime in `timeZone` to a UTC instant.
 * DST gap (spring forward): advance to the next valid local time.
 * DST overlap (fall back): choose the earlier offset.
 */
export function zonedLocalToUtcMs(
  parts: { year: number; month: number; day: number; hour: number; minute: number; second?: number },
  timeZone: string,
): number {
  const want = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0,
  );
  let guess = want;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const got = utcToZonedParts(guess, timeZone);
    const gotAsUtc = Date.UTC(got.year, got.month - 1, got.day, got.hour, got.minute, got.second);
    const delta = want - gotAsUtc;
    if (delta === 0) return guess;
    guess += delta;
  }
  for (let step = 0; step < 8; step += 1) {
    guess += 15 * 60_000;
    const got = utcToZonedParts(guess, timeZone);
    if (
      got.year === parts.year
      && got.month === parts.month
      && got.day === parts.day
      && got.hour === parts.hour
      && got.minute === parts.minute
    ) {
      return guess;
    }
  }
  return guess;
}

export function formatZonedTime(utcMs: number, timeZone: string): string {
  const parts = utcToZonedParts(utcMs, timeZone);
  return `${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function formatZonedDate(utcMs: number, timeZone: string): string {
  const parts = utcToZonedParts(utcMs, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function addLocalDays(parts: ZonedParts, days: number): ZonedParts {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0);
  const shifted = new Date(utc);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function isoWeekday(parts: Pick<ZonedParts, 'year' | 'month' | 'day'>): number {
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0);
  const day = new Date(utc).getUTCDay();
  return day === 0 ? 7 : day;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

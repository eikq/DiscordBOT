import { LOCAL_DATE_PATTERN, LOCAL_TIME_PATTERN } from './constants';
import {
  addLocalDays,
  formatZonedDate,
  isoWeekday,
  utcToZonedParts,
  zonedLocalToUtcMs,
} from './timezone';
import type { ParseScheduleErr, ReminderSchedule, Weekday } from './types';

export function parseLocalTime(value: string): { hour: number; minute: number } | undefined {
  if (!LOCAL_TIME_PATTERN.test(value)) return undefined;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3, 5));
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

export function parseLocalDate(value: string): { year: number; month: number; day: number } | undefined {
  if (!LOCAL_DATE_PATTERN.test(value)) return undefined;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return undefined;
  }
  return { year, month, day };
}

export function formatLocalTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function validateSchedule(schedule: ReminderSchedule): ParseScheduleErr | undefined {
  if (schedule.kind === 'once_relative') {
    if (!Number.isFinite(schedule.offsetMs) || schedule.offsetMs <= 0 || schedule.offsetMs > 366 * 24 * 60 * 60_000) {
      return { ok: false, reasonCode: 'MALFORMED_SCHEDULE', userMessage: 'That relative time is not schedulable.' };
    }
    return undefined;
  }
  const time = parseLocalTime(schedule.localTime);
  if (!time) {
    return { ok: false, reasonCode: 'MALFORMED_SCHEDULE', userMessage: 'That time is not schedulable.' };
  }
  if (schedule.kind === 'once_absolute' && !parseLocalDate(schedule.localDate)) {
    return { ok: false, reasonCode: 'MALFORMED_SCHEDULE', userMessage: 'That date is not schedulable.' };
  }
  if (schedule.kind === 'weekly' && (schedule.weekday < 1 || schedule.weekday > 7)) {
    return { ok: false, reasonCode: 'MALFORMED_SCHEDULE', userMessage: 'That weekday is not schedulable.' };
  }
  if (schedule.kind === 'weekdays') {
    if (schedule.days.length === 0 || schedule.days.some(day => day < 1 || day > 7)) {
      return { ok: false, reasonCode: 'MALFORMED_SCHEDULE', userMessage: 'Those weekdays are not schedulable.' };
    }
  }
  return undefined;
}

export function computeNextRunAt(
  schedule: ReminderSchedule,
  timeZone: string,
  nowMs: number,
): { nextRunAt: number } | { reasonCode: 'PAST_TIME' | 'MALFORMED_SCHEDULE'; userMessage: string } {
  const invalid = validateSchedule(schedule);
  if (invalid) return { reasonCode: 'MALFORMED_SCHEDULE', userMessage: invalid.userMessage };

  if (schedule.kind === 'once_relative') {
    return { nextRunAt: nowMs + schedule.offsetMs };
  }

  if (schedule.kind === 'once_absolute') {
    const date = parseLocalDate(schedule.localDate)!;
    const time = parseLocalTime(schedule.localTime)!;
    const utc = zonedLocalToUtcMs({ ...date, ...time, second: 0 }, timeZone);
    if (utc <= nowMs) {
      return {
        reasonCode: 'PAST_TIME',
        userMessage: 'That time has already passed. Say tomorrow or pick a later time.',
      };
    }
    return { nextRunAt: utc };
  }

  const nowParts = utcToZonedParts(nowMs, timeZone);
  const time = parseLocalTime(schedule.localTime)!;

  if (schedule.kind === 'daily') {
    return { nextRunAt: nextDaily(nowMs, nowParts, time, timeZone) };
  }

  const days = schedule.kind === 'weekly' ? [schedule.weekday] : uniqueDays(schedule.days);
  return { nextRunAt: nextOnWeekdays(nowMs, nowParts, time, days, timeZone) };
}

export function nextAfterOccurrence(
  schedule: ReminderSchedule,
  timeZone: string,
  occurrenceUtcMs: number,
): number | null {
  if (schedule.kind === 'once_relative' || schedule.kind === 'once_absolute') return null;
  const next = computeNextRunAt(schedule, timeZone, occurrenceUtcMs + 1_000);
  return 'nextRunAt' in next ? next.nextRunAt : null;
}

export function isRecurring(schedule: ReminderSchedule): boolean {
  return schedule.kind === 'daily' || schedule.kind === 'weekly' || schedule.kind === 'weekdays';
}

export function scheduleLabel(schedule: ReminderSchedule): string {
  if (schedule.kind === 'once_relative') return `in ${Math.round(schedule.offsetMs / 60_000)} min`;
  if (schedule.kind === 'once_absolute') return `${schedule.localDate} ${schedule.localTime}`;
  if (schedule.kind === 'daily') return `DAILY ${schedule.localTime}`;
  if (schedule.kind === 'weekly') return `${weekdayName(schedule.weekday)} ${schedule.localTime}`;
  return `DAYS ${schedule.days.join(',')} ${schedule.localTime}`;
}

function nextDaily(
  nowMs: number,
  nowParts: ReturnType<typeof utcToZonedParts>,
  time: { hour: number; minute: number },
  timeZone: string,
): number {
  let candidate = zonedLocalToUtcMs({
    year: nowParts.year,
    month: nowParts.month,
    day: nowParts.day,
    hour: time.hour,
    minute: time.minute,
    second: 0,
  }, timeZone);
  if (candidate > nowMs) return candidate;
  const tomorrow = addLocalDays(nowParts, 1);
  return zonedLocalToUtcMs({
    year: tomorrow.year,
    month: tomorrow.month,
    day: tomorrow.day,
    hour: time.hour,
    minute: time.minute,
    second: 0,
  }, timeZone);
}

function nextOnWeekdays(
  nowMs: number,
  nowParts: ReturnType<typeof utcToZonedParts>,
  time: { hour: number; minute: number },
  days: Weekday[],
  timeZone: string,
): number {
  const today = isoWeekday(nowParts) as Weekday;
  for (let offset = 0; offset < 8; offset += 1) {
    const weekday = (((today - 1 + offset) % 7) + 1) as Weekday;
    if (!days.includes(weekday)) continue;
    const local = addLocalDays(nowParts, offset);
    const utc = zonedLocalToUtcMs({
      year: local.year,
      month: local.month,
      day: local.day,
      hour: time.hour,
      minute: time.minute,
      second: 0,
    }, timeZone);
    if (utc > nowMs) return utc;
  }
  const fallback = addLocalDays(nowParts, 7);
  return zonedLocalToUtcMs({
    year: fallback.year,
    month: fallback.month,
    day: fallback.day,
    hour: time.hour,
    minute: time.minute,
    second: 0,
  }, timeZone);
}

function uniqueDays(days: Weekday[]): Weekday[] {
  return [...new Set(days)].sort((left, right) => left - right) as Weekday[];
}

function weekdayName(day: Weekday): string {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1] || String(day);
}

export function todayLocalDate(nowMs: number, timeZone: string): string {
  return formatZonedDate(nowMs, timeZone);
}

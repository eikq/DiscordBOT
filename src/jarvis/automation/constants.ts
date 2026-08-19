import type { ReminderStatus } from './types';

export const REMINDERS_CREATE = 'reminders.create';
export const REMINDERS_LIST = 'reminders.list';
export const REMINDERS_GET = 'reminders.get';
export const REMINDERS_CANCEL = 'reminders.cancel';
export const REMINDERS_PAUSE = 'reminders.pause';
export const REMINDERS_RESUME = 'reminders.resume';
export const REMINDERS_RESCHEDULE = 'reminders.reschedule';
export const REMINDERS_COMPLETE = 'reminders.complete';
export const REMINDERS_DISMISS = 'reminders.dismiss';
export const REMINDERS_SNOOZE = 'reminders.snooze';

export const REMINDER_CAPABILITY_IDS = [
  REMINDERS_CREATE,
  REMINDERS_LIST,
  REMINDERS_GET,
  REMINDERS_CANCEL,
  REMINDERS_PAUSE,
  REMINDERS_RESUME,
  REMINDERS_RESCHEDULE,
  REMINDERS_COMPLETE,
  REMINDERS_DISMISS,
  REMINDERS_SNOOZE,
] as const;

export const REMINDER_READ_IDS = [REMINDERS_LIST, REMINDERS_GET] as const;

export const REMINDER_STATUSES: readonly ReminderStatus[] = [
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
];

export const REMINDER_ID_PATTERN = /^rem_[a-f0-9]{16}$/u;
export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
export const LOCAL_TIME_PATTERN = /^\d{2}:\d{2}$/u;

export const MAX_TITLE_CHARS = 200;
export const MAX_MESSAGE_CHARS = 500;
export const MAX_WHEN_TEXT_CHARS = 400;
export const MAX_QUERY_CHARS = 200;

export const ONE_TIME_GRACE_MS = 15 * 60_000;
export const ONE_TIME_EXPIRE_MS = 24 * 60 * 60_000;
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const SNOOZE_MINUTES = [10, 30, 60] as const;

export const DAYPART_DEFAULTS = {
  morning: '08:00',
  noon: '12:00',
  afternoon: '15:00',
  evening: '18:00',
  night: '21:00',
} as const;

export const AUTOMATION_SCHEMA_VERSION = 1;

export function isReminderCapabilityId(id: string): boolean {
  return (REMINDER_CAPABILITY_IDS as readonly string[]).includes(id);
}

export function isReminderReadCapability(id: string): boolean {
  return (REMINDER_READ_IDS as readonly string[]).includes(id);
}

export function isReminderStatus(value: string): value is ReminderStatus {
  return (REMINDER_STATUSES as readonly string[]).includes(value);
}

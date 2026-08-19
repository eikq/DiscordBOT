export type ReminderStatus =
  | 'ACTIVE'
  | 'PAUSED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED';

export type ReminderCreatedFrom = 'user_text' | 'ui' | 'recovery';
export type ReminderDeliveryMode = 'notification' | 'notification_and_speech';
export type OccurrenceStatus =
  | 'claimed'
  | 'delivered'
  | 'missed'
  | 'dismissed'
  | 'completed'
  | 'expired'
  | 'failed';

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ReminderSchedule =
  | { kind: 'once_relative'; offsetMs: number }
  | { kind: 'once_absolute'; localDate: string; localTime: string }
  | { kind: 'daily'; localTime: string }
  | { kind: 'weekly'; weekday: Weekday; localTime: string }
  | { kind: 'weekdays'; days: Weekday[]; localTime: string };

export type TimeTrigger = {
  kind: 'time';
  schedule: ReminderSchedule;
  timeZone: string;
};

export type ReminderRecord = {
  id: string;
  title: string;
  message: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
  timezone: string;
  schedule: ReminderSchedule;
  nextRunAt: string | null;
  lastRunAt: string | null;
  createdFrom: ReminderCreatedFrom;
  deliveryMode: ReminderDeliveryMode;
  revision: number;
  metadata: Record<string, unknown>;
};

export type ReminderOccurrence = {
  id: string;
  reminderId: string;
  scheduledAt: string;
  status: OccurrenceStatus;
  claimedAt: string | null;
  deliveredAt: string | null;
  ackedAt: string | null;
  deliveryKind: 'on_time' | 'missed' | null;
};

export type PendingDelivery = {
  reminderId: string;
  occurrenceAt: string;
  title: string;
  message: string;
  scheduledLocal: string;
  kind: 'on_time' | 'missed';
  recurrence: ReminderSchedule['kind'];
};

export type SchedulerStatus = {
  healthy: boolean;
  attached: boolean;
  timezone: string;
  nextRunAt: string | null;
  activeCount: number;
  pendingCount: number;
  reason?: string;
};

export type ReminderSnapshot = {
  scheduler: SchedulerStatus;
  reminders: ReminderRecord[];
  pendingDeliveries: PendingDelivery[];
};

export type ParseFailureCode =
  | 'INVALID'
  | 'AMBIGUOUS_TIME'
  | 'CLARIFY'
  | 'PAST_TIME'
  | 'UNSUPPORTED_ACTION'
  | 'UNSUPPORTED_SQL'
  | 'MALFORMED_SCHEDULE';

export type ParseScheduleOk = {
  ok: true;
  schedule: ReminderSchedule;
  titleHint?: string;
};

export type ParseScheduleErr = {
  ok: false;
  reasonCode: ParseFailureCode;
  userMessage: string;
};

export type ParseScheduleResult = ParseScheduleOk | ParseScheduleErr;

export type JarvisClock = {
  now(): number;
};

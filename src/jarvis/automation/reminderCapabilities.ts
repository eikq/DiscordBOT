import type { CapabilityHandler, CapabilityHost, CapabilityResult } from '../capabilities/types';
import {
  MAX_MESSAGE_CHARS,
  MAX_QUERY_CHARS,
  MAX_TITLE_CHARS,
  REMINDERS_CANCEL,
  REMINDERS_COMPLETE,
  REMINDERS_CREATE,
  REMINDERS_DISMISS,
  REMINDERS_GET,
  REMINDERS_LIST,
  REMINDERS_PAUSE,
  REMINDERS_RESCHEDULE,
  REMINDERS_RESUME,
  REMINDERS_SNOOZE,
  SNOOZE_MINUTES,
} from './constants';
import { extractReminderTitle, parseScheduleText, reminderTextAsData } from './parseSchedule';
import type { ReminderAuditLog } from './reminderAudit';
import { selectReminders } from './reminderSelection';
import type { ReminderStore } from './reminderStore';
import { computeNextRunAt, isRecurring, scheduleLabel, validateSchedule } from './schedule';
import type { ReminderScheduler } from './scheduler';
import type { JarvisClock, ReminderSchedule, ReminderStatus } from './types';

export type ReminderCapabilityDeps = {
  store?: ReminderStore;
  scheduler?: ReminderScheduler;
  audit?: ReminderAuditLog;
  clock?: JarvisClock;
};

export function registerReminderCapabilities(host: CapabilityHost, deps: ReminderCapabilityDeps): void {
  const ids = [
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
  ];
  for (const id of ids) {
    host.register(createHandler(id, deps));
  }
}

function createHandler(id: string, deps: ReminderCapabilityDeps): CapabilityHandler {
  const read = id === REMINDERS_LIST || id === REMINDERS_GET;
  return {
    descriptor: () => ({
      id,
      description: `Jarvis reminder ${id.replace('reminders.', '')}. Delivers a notification only.`,
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: { type: 'object' },
      sideEffect: read ? 'read' : 'write',
      requiredService: 'reminders',
      providerKind: 'local',
      timeoutMs: 3_000,
      untrustedOutput: false,
      effects: read ? undefined : [{
        kind: 'DATA_CHANGE',
        description: 'Change one Jarvis reminder record and its notification schedule.',
        destructive: false,
        reversible: id !== REMINDERS_COMPLETE && id !== REMINDERS_DISMISS,
        privilege: 'standard_user',
        targetInputFields: ['reminderId', 'title'],
        estimatedAffectedObjects: 1,
      }],
      verification: read
        ? { mode: 'not_applicable', description: 'Read-only reminder lookup.' }
        : { mode: 'handler_result', description: 'Confirm the reminder store accepted the typed mutation.' },
      rollback: read
        ? { mode: 'not_required', strategy: 'Read-only operation.' }
        : { mode: 'manual_recovery', strategy: 'A later typed reminder mutation may restore the prior state.', priorStateField: 'priorStateId' },
    }),
    availability: async () => ({
      id,
      availability: deps.store ? 'up' : 'unavailable',
      degraded: !deps.store,
      reason: deps.store ? undefined : 'Reminder store is unavailable.',
    }),
    invoke: async (input) => invokeReminder(id, input, deps),
  };
}

async function invokeReminder(
  id: string,
  input: Record<string, unknown>,
  deps: ReminderCapabilityDeps,
): Promise<CapabilityResult> {
  if (!deps.store) {
    return terminal(id, 'unavailable', 'STORE_UNAVAILABLE', 'Reminder store is unavailable.');
  }
  const store = deps.store;
  const now = deps.clock?.now() ?? Date.now();
  try {
    if (id === REMINDERS_CREATE) return createReminder(store, input, now, deps);
    if (id === REMINDERS_LIST) return listReminders(store, input);
    if (id === REMINDERS_GET) return getReminder(store, input);
    if (id === REMINDERS_CANCEL) return mutateSelected(store, input, 'cancel', deps);
    if (id === REMINDERS_PAUSE) return mutateSelected(store, input, 'pause', deps);
    if (id === REMINDERS_RESUME) return mutateSelected(store, input, 'resume', deps);
    if (id === REMINDERS_COMPLETE) return mutateSelected(store, input, 'complete', deps);
    if (id === REMINDERS_RESCHEDULE) return rescheduleSelected(store, input, now, deps);
    if (id === REMINDERS_DISMISS) return ack(store, input, 'dismiss', deps);
    if (id === REMINDERS_SNOOZE) return snooze(store, input, deps);
    return terminal(id, 'unavailable', 'UNKNOWN_CAPABILITY', 'Unknown reminder capability.');
  } catch (error) {
    const reason = error instanceof Error && 'reasonCode' in error
      ? String((error as { reasonCode?: string }).reasonCode)
      : 'STORE_ERROR';
    return terminal(id, reason === 'PAST_TIME' ? 'rejected' : 'unavailable', reason, error instanceof Error ? error.message : 'Reminder store failed.');
  }
}

function createReminder(
  store: ReminderStore,
  input: Record<string, unknown>,
  now: number,
  deps: ReminderCapabilityDeps,
): CapabilityResult {
  const title = reminderTextAsData(String(input.title || extractReminderTitle(String(input.whenText || '')) || 'Reminder'), MAX_TITLE_CHARS);
  const message = reminderTextAsData(String(input.message || title), MAX_MESSAGE_CHARS);
  const structured = structuredSchedule(input);
  const parsed = structured
    ?? parseScheduleText(String(input.whenText || ''), now, store.timezone());
  if (!parsed || parsed.ok === false) {
    return terminal(
      REMINDERS_CREATE,
      'rejected',
      parsed && parsed.ok === false ? parsed.reasonCode : 'INVALID',
      parsed && parsed.ok === false ? parsed.userMessage : 'I could not schedule that reminder.',
    );
  }
  const created = store.create({
    title: title || parsed.titleHint || 'Reminder',
    message,
    schedule: parsed.schedule,
    createdFrom: input.createdFrom === 'ui' ? 'ui' : 'user_text',
    deliveryMode: input.deliveryMode === 'notification_and_speech' ? 'notification_and_speech' : 'notification',
  });
  deps.scheduler?.poke();
  deps.audit?.record({
    v: 1,
    event: 'created',
    at: created.createdAt,
    reminderId: created.id,
    scheduledAt: created.nextRunAt ?? undefined,
    source: 'capability',
    title: created.title,
  });
  return {
    capabilityId: REMINDERS_CREATE,
    status: 'ok',
    structured: {
      status: 'completed',
      risk: 'LOW_RISK_ACTION',
      reminder: publicReminder(created),
      reasonCode: 'CREATED',
    },
    content: confirmCreate(created),
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
  };
}

function listReminders(store: ReminderStore, input: Record<string, unknown>): CapabilityResult {
  const status = typeof input.status === 'string' ? input.status as ReminderStatus : undefined;
  const items = store.list({
    status: status || ['ACTIVE', 'PAUSED'],
    query: typeof input.query === 'string' ? input.query.slice(0, MAX_QUERY_CHARS) : undefined,
  });
  return {
    capabilityId: REMINDERS_LIST,
    status: 'ok',
    structured: {
      status: 'completed',
      risk: 'READ_ONLY',
      reminders: items.map(publicReminder),
      count: items.length,
    },
    content: items.length === 0
      ? 'ยังไม่มี reminder ที่ใช้งานอยู่ครับ'
      : items.map(item => `${item.nextRunAt ? scheduleLabel(item.schedule) : item.status} · ${item.title}`).join('\n'),
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'read',
  };
}

function getReminder(store: ReminderStore, input: Record<string, unknown>): CapabilityResult {
  const reminder = store.get(String(input.reminderId || ''));
  if (!reminder) return terminal(REMINDERS_GET, 'unavailable', 'UNKNOWN_REMINDER', 'I could not find that reminder.');
  return {
    capabilityId: REMINDERS_GET,
    status: 'ok',
    structured: { status: 'completed', risk: 'READ_ONLY', reminder: publicReminder(reminder) },
    content: `${reminder.title} · ${reminder.status}`,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'read',
  };
}

function mutateSelected(
  store: ReminderStore,
  input: Record<string, unknown>,
  action: 'cancel' | 'pause' | 'resume' | 'complete',
  deps: ReminderCapabilityDeps,
): CapabilityResult {
  const selected = resolveTarget(store, input);
  if (selected.kind !== 'one') return selectionResult(capabilityFor(action), selected);
  const reminder = selected.reminder;
  if (action === 'cancel') store.setStatus(reminder.id, 'CANCELLED', { nextRunAt: null });
  if (action === 'pause') store.setStatus(reminder.id, 'PAUSED', { nextRunAt: null });
  if (action === 'resume') {
    const resumed = store.resume(reminder.id);
    if (resumed?.status === 'EXPIRED') {
      return terminal(REMINDERS_RESUME, 'rejected', 'PAST_TIME', 'That reminder time has already passed.');
    }
  }
  if (action === 'complete') store.setStatus(reminder.id, 'COMPLETED', { nextRunAt: null });
  deps.scheduler?.poke();
  deps.audit?.record({
    v: 1,
    event: action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'completed',
    at: new Date(deps.clock?.now() ?? Date.now()).toISOString(),
    reminderId: reminder.id,
    source: 'capability',
    title: reminder.title,
  });
  const verb = action === 'cancel' ? 'ยกเลิก' : action === 'pause' ? 'พัก' : action === 'resume' ? 'เปิดใช้' : 'ปิด';
  return {
    capabilityId: capabilityFor(action),
    status: 'ok',
    structured: { status: 'completed', risk: 'LOW_RISK_ACTION', reminderId: reminder.id },
    content: `${verb} reminder «${reminder.title}» แล้วครับ`,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
  };
}

function rescheduleSelected(
  store: ReminderStore,
  input: Record<string, unknown>,
  now: number,
  deps: ReminderCapabilityDeps,
): CapabilityResult {
  const selected = resolveTarget(store, input);
  if (selected.kind !== 'one') return selectionResult(REMINDERS_RESCHEDULE, selected);
  const structured = structuredSchedule(input);
  const parsed = structured ?? parseScheduleText(String(input.whenText || ''), now, store.timezone());
  if (!parsed || parsed.ok === false) {
    return terminal(
      REMINDERS_RESCHEDULE,
      'rejected',
      parsed && parsed.ok === false ? parsed.reasonCode : 'INVALID',
      parsed && parsed.ok === false ? parsed.userMessage : 'I could not reschedule that.',
    );
  }
  const updated = store.reschedule(selected.reminder.id, parsed.schedule);
  deps.scheduler?.poke();
  deps.audit?.record({
    v: 1,
    event: 'rescheduled',
    at: updated?.updatedAt || new Date(now).toISOString(),
    reminderId: selected.reminder.id,
    scheduledAt: updated?.nextRunAt ?? undefined,
    source: 'capability',
    title: selected.reminder.title,
  });
  return {
    capabilityId: REMINDERS_RESCHEDULE,
    status: 'ok',
    structured: { status: 'completed', risk: 'LOW_RISK_ACTION', reminder: updated ? publicReminder(updated) : undefined },
    content: `เลื่อน «${selected.reminder.title}» แล้วครับ`,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
  };
}

function ack(
  store: ReminderStore,
  input: Record<string, unknown>,
  action: 'dismiss' | 'complete',
  deps: ReminderCapabilityDeps,
): CapabilityResult {
  const reminderId = String(input.reminderId || '');
  const occurrenceAt = String(input.occurrenceAt || '');
  const reminder = store.get(reminderId);
  if (!reminder) return terminal(REMINDERS_DISMISS, 'unavailable', 'UNKNOWN_REMINDER', 'I could not find that reminder.');
  store.ackOccurrence(reminderId, occurrenceAt, action);
  if (action === 'complete' && isRecurring(reminder.schedule)) {
    // Recurring complete of an occurrence does not cancel the series.
  }
  deps.scheduler?.poke();
  deps.audit?.record({
    v: 1,
    event: action === 'complete' ? 'completed' : 'dismissed',
    at: new Date(deps.clock?.now() ?? Date.now()).toISOString(),
    reminderId,
    scheduledAt: occurrenceAt,
    source: 'ui',
    title: reminder.title,
  });
  return {
    capabilityId: REMINDERS_DISMISS,
    status: 'ok',
    structured: { status: 'completed', risk: 'LOW_RISK_ACTION', reminderId, occurrenceAt },
    content: action === 'complete' ? 'ปิด reminder นี้แล้วครับ' : 'รับทราบแล้วครับ',
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
  };
}

function snooze(store: ReminderStore, input: Record<string, unknown>, deps: ReminderCapabilityDeps): CapabilityResult {
  const minutes = Number(input.minutes);
  if (!(SNOOZE_MINUTES as readonly number[]).includes(minutes)) {
    return terminal(REMINDERS_SNOOZE, 'rejected', 'INVALID_SNOOZE', 'Snooze can be 10, 30, or 60 minutes.');
  }
  const selected = resolveTarget(store, input);
  if (selected.kind !== 'one') return selectionResult(REMINDERS_SNOOZE, selected);
  if (input.occurrenceAt) {
    store.ackOccurrence(selected.reminder.id, String(input.occurrenceAt), 'dismiss');
  }
  const updated = store.snooze(selected.reminder.id, minutes);
  deps.scheduler?.poke();
  deps.audit?.record({
    v: 1,
    event: 'snoozed',
    at: updated?.updatedAt || new Date().toISOString(),
    reminderId: selected.reminder.id,
    scheduledAt: updated?.nextRunAt ?? undefined,
    source: 'ui',
    title: selected.reminder.title,
  });
  return {
    capabilityId: REMINDERS_SNOOZE,
    status: 'ok',
    structured: { status: 'completed', risk: 'LOW_RISK_ACTION', reminder: updated ? publicReminder(updated) : undefined },
    content: `เลื่อน «${selected.reminder.title}» ไปอีก ${minutes} นาทีครับ`,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
  };
}

function resolveTarget(store: ReminderStore, input: Record<string, unknown>) {
  if (typeof input.reminderId === 'string' && input.reminderId) {
    const reminder = store.get(input.reminderId);
    return reminder ? { kind: 'one' as const, reminder } : { kind: 'none' as const };
  }
  const query = typeof input.query === 'string' ? input.query.slice(0, MAX_QUERY_CHARS) : '';
  return selectReminders(store.list({ status: ['ACTIVE', 'PAUSED'] }), query);
}

function selectionResult(capabilityId: string, selected: ReturnType<typeof resolveTarget>): CapabilityResult {
  if (selected.kind === 'none') {
    return terminal(capabilityId, 'unavailable', 'UNKNOWN_REMINDER', 'I could not find that reminder.');
  }
  const candidates = selected.kind === 'many' ? selected.reminders : [];
  return {
    capabilityId,
    status: 'rejected',
    structured: {
      status: 'denied',
      reasonCode: 'SELECTION_REQUIRED',
      risk: 'LOW_RISK_ACTION',
      candidates: candidates.map(item => ({ id: item.id, title: item.title })),
    },
    content: 'มีหลายอันที่ตรงกัน บอกชื่อที่ชัดกว่านี้หน่อยครับ',
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
    error: 'SELECTION_REQUIRED',
  };
}

function structuredSchedule(input: Record<string, unknown>): ReturnType<typeof parseScheduleText> | undefined {
  const kind = input.scheduleKind;
  if (typeof kind !== 'string') return undefined;
  let schedule: ReminderSchedule | undefined;
  if (kind === 'once_relative' && typeof input.offsetMs === 'number') {
    schedule = { kind, offsetMs: input.offsetMs };
  } else if (kind === 'once_absolute' && typeof input.localDate === 'string' && typeof input.localTime === 'string') {
    schedule = { kind, localDate: input.localDate, localTime: input.localTime };
  } else if (kind === 'daily' && typeof input.localTime === 'string') {
    schedule = { kind, localTime: input.localTime };
  } else if (kind === 'weekly' && typeof input.localTime === 'string' && typeof input.weekday === 'number') {
    schedule = { kind, weekday: input.weekday as 1, localTime: input.localTime };
  } else if (kind === 'weekdays' && typeof input.localTime === 'string' && Array.isArray(input.days)) {
    schedule = { kind, days: input.days as 1[], localTime: input.localTime };
  }
  if (!schedule) {
    return { ok: false, reasonCode: 'MALFORMED_SCHEDULE', userMessage: 'That schedule is not valid.' };
  }
  const invalid = validateSchedule(schedule);
  if (invalid) return invalid;
  return { ok: true, schedule };
}

function publicReminder(record: ReturnType<ReminderStore['get']> & object) {
  return {
    id: record.id,
    title: record.title,
    message: record.message,
    status: record.status,
    timezone: record.timezone,
    schedule: record.schedule,
    nextRunAt: record.nextRunAt,
    lastRunAt: record.lastRunAt,
    revision: record.revision,
  };
}

function confirmCreate(record: { title: string; schedule: ReminderSchedule; nextRunAt: string | null }): string {
  if (record.schedule.kind === 'once_relative') {
    const minutes = Math.round(record.schedule.offsetMs / 60_000);
    if (record.schedule.offsetMs < 60_000) {
      return `ได้ครับ ผมจะเตือนให้ ${record.title} อีก ${Math.round(record.schedule.offsetMs / 1_000)} วินาที`;
    }
    if (record.schedule.offsetMs % (60 * 60_000) === 0) {
      return `ได้ครับ ผมจะเตือนให้ ${record.title} อีก ${record.schedule.offsetMs / (60 * 60_000)} ชั่วโมง`;
    }
    return `ได้ครับ ผมจะเตือนให้ ${record.title} อีก ${minutes} นาที`;
  }
  return `ได้ครับ ตั้งเตือน «${record.title}» แล้ว (${scheduleLabel(record.schedule)})`;
}

function capabilityFor(action: 'cancel' | 'pause' | 'resume' | 'complete'): string {
  if (action === 'cancel') return REMINDERS_CANCEL;
  if (action === 'pause') return REMINDERS_PAUSE;
  if (action === 'resume') return REMINDERS_RESUME;
  return REMINDERS_COMPLETE;
}

function terminal(
  capabilityId: string,
  status: 'rejected' | 'unavailable',
  reasonCode: string,
  userMessage: string,
): CapabilityResult {
  return {
    capabilityId,
    status: status === 'unavailable' ? 'unavailable' : 'rejected',
    structured: {
      status: reasonCode === 'AMBIGUOUS_TIME' || reasonCode === 'CLARIFY' || reasonCode === 'PAST_TIME' || reasonCode === 'SELECTION_REQUIRED'
        ? 'denied'
        : status,
      reasonCode,
      risk: 'LOW_RISK_ACTION',
      summary: userMessage,
    },
    content: userMessage,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: capabilityId === REMINDERS_LIST || capabilityId === REMINDERS_GET ? 'read' : 'write',
    error: reasonCode,
  };
}

export { computeNextRunAt };

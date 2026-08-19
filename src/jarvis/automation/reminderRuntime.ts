import { systemClock, type FakeClock } from './clock';
import { defaultReminderAuditPath, ReminderAuditLog } from './reminderAudit';
import { defaultAutomationDbPath, ReminderStore } from './reminderStore';
import { ReminderScheduler, type ReminderSpeechPort } from './scheduler';
import type { JarvisClock } from './types';

export type ReminderRuntime = {
  store: ReminderStore;
  scheduler: ReminderScheduler;
  audit: ReminderAuditLog;
  clock: JarvisClock;
};

export type ReminderRuntimeOptions = {
  dbPath?: string;
  auditPath?: string;
  clock?: JarvisClock | FakeClock;
  timeZone?: string;
  speech?: ReminderSpeechPort;
  start?: boolean;
};

let shared: ReminderRuntime | undefined;

export function createReminderRuntime(options: ReminderRuntimeOptions = {}): ReminderRuntime {
  const clock = options.clock ?? systemClock;
  const store = new ReminderStore(
    options.dbPath ?? defaultAutomationDbPath(),
    clock,
    { timeZone: options.timeZone },
  );
  const audit = new ReminderAuditLog(options.auditPath ?? defaultReminderAuditPath());
  const scheduler = new ReminderScheduler(store, clock, audit, options.speech);
  if (options.start !== false) scheduler.start();
  return { store, scheduler, audit, clock };
}

export function sharedReminderRuntime(options: ReminderRuntimeOptions = {}): ReminderRuntime {
  if (!shared) {
    shared = createReminderRuntime({ ...options, start: options.start !== false });
  }
  return shared;
}

export function trySharedReminderRuntime(options: ReminderRuntimeOptions = {}): ReminderRuntime | undefined {
  try {
    return sharedReminderRuntime(options);
  } catch (error) {
    console.warn(`[Jarvis] Reminder store unavailable: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

export function resetSharedReminderRuntime(): void {
  if (!shared) return;
  shared.scheduler.stop();
  shared.store.close();
  shared = undefined;
}

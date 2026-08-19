import { isoUtc } from './clock';
import { MAX_TIMER_DELAY_MS, ONE_TIME_EXPIRE_MS, ONE_TIME_GRACE_MS } from './constants';
import type { ReminderAuditLog } from './reminderAudit';
import type { ReminderStore } from './reminderStore';
import { isRecurring } from './schedule';
import { formatZonedTime } from './timezone';
import type { JarvisClock, PendingDelivery, ReminderRecord, SchedulerStatus } from './types';

export type ReminderSpeechPort = {
  speak?(text: string): Promise<unknown>;
};

export type FireReport = {
  reminderId: string;
  scheduledAt: string;
  delivered: boolean;
  duplicate: boolean;
  kind: 'on_time' | 'missed' | 'expired' | 'skipped';
};

export class ReminderScheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private firing = false;

  constructor(
    private readonly store: ReminderStore,
    private readonly clock: JarvisClock,
    private readonly audit?: ReminderAuditLog,
    private readonly speech?: ReminderSpeechPort,
  ) {}

  public start(): void {
    this.running = true;
    this.recover();
    this.arm();
  }

  public stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  public poke(): void {
    this.arm();
  }

  public status(): SchedulerStatus {
    const pending = this.store.pendingDeliveries();
    return {
      healthy: this.running,
      attached: true,
      timezone: this.store.timezone(),
      nextRunAt: this.store.nearestNextRunAt(),
      activeCount: this.store.list({ status: 'ACTIVE' }).length,
      pendingCount: pending.length,
    };
  }

  public snapshot(): { scheduler: SchedulerStatus; reminders: ReminderRecord[]; pendingDeliveries: PendingDelivery[] } {
    return {
      scheduler: this.status(),
      reminders: this.store.list({ status: ['ACTIVE', 'PAUSED'] }),
      pendingDeliveries: this.store.pendingDeliveries(),
    };
  }

  public recover(): FireReport[] {
    const now = this.clock.now();
    const reports: FireReport[] = [];
    for (const reminder of this.store.list({ status: 'ACTIVE' })) {
      if (!reminder.nextRunAt) continue;
      const dueAt = Date.parse(reminder.nextRunAt);
      if (!Number.isFinite(dueAt) || dueAt >= now) continue;
      const lateness = now - dueAt;
      if (isRecurring(reminder.schedule)) {
        this.store.skipRecurringToNext(reminder, now);
        this.audit?.record({
          v: 1,
          event: 'recovered',
          at: isoUtc(now),
          reminderId: reminder.id,
          scheduledAt: reminder.nextRunAt,
          source: 'recovery',
          reasonCode: 'MISSED_RECURRENCE_SKIPPED',
        });
        reports.push({
          reminderId: reminder.id,
          scheduledAt: reminder.nextRunAt,
          delivered: false,
          duplicate: false,
          kind: 'skipped',
        });
        continue;
      }
      if (lateness <= ONE_TIME_GRACE_MS) {
        reports.push(...this.deliverOne(reminder, 'missed'));
        continue;
      }
      this.store.markExpired(reminder.id);
      this.audit?.record({
        v: 1,
        event: 'expired',
        at: isoUtc(now),
        reminderId: reminder.id,
        scheduledAt: reminder.nextRunAt,
        source: 'recovery',
        reasonCode: lateness > ONE_TIME_EXPIRE_MS ? 'ONE_TIME_EXPIRED' : 'ONE_TIME_STALE',
      });
      reports.push({
        reminderId: reminder.id,
        scheduledAt: reminder.nextRunAt,
        delivered: false,
        duplicate: false,
        kind: 'expired',
      });
    }
    return reports;
  }

  public fireDue(): FireReport[] {
    if (this.firing) return [];
    this.firing = true;
    try {
      const reports: FireReport[] = [];
      for (const reminder of this.store.due(this.clock.now())) {
        reports.push(...this.deliverOne(reminder, 'on_time'));
      }
      this.arm();
      return reports;
    } finally {
      this.firing = false;
    }
  }

  private deliverOne(reminder: ReminderRecord, kind: 'on_time' | 'missed'): FireReport[] {
    const scheduledAt = reminder.nextRunAt;
    if (!scheduledAt) return [];
    if (this.store.hasOccurrence(reminder.id, scheduledAt)) {
      return [{ reminderId: reminder.id, scheduledAt, delivered: false, duplicate: true, kind }];
    }
    const claimed = this.store.claimDue(reminder, this.clock.now());
    if (!claimed) {
      return [{ reminderId: reminder.id, scheduledAt, delivered: false, duplicate: true, kind }];
    }
    const deliveredAt = isoUtc(this.clock.now());
    try {
      this.store.markDelivered(claimed, kind, deliveredAt);
      this.audit?.record({
        v: 1,
        event: 'fired',
        at: deliveredAt,
        reminderId: reminder.id,
        scheduledAt,
        deliveredAt,
        source: 'scheduler',
        title: reminder.title,
      });
      if (reminder.deliveryMode === 'notification_and_speech' && this.speech?.speak) {
        const spoken = `เตือนครับ ถึงเวลา${reminder.title}แล้ว`;
        void this.speech.speak(spoken).catch(() => undefined);
      }
      return [{ reminderId: reminder.id, scheduledAt, delivered: true, duplicate: false, kind }];
    } catch (error) {
      this.audit?.record({
        v: 1,
        event: 'delivery_failed',
        at: deliveredAt,
        reminderId: reminder.id,
        scheduledAt,
        source: 'scheduler',
        reasonCode: error instanceof Error ? error.message.slice(0, 80) : 'DELIVERY_FAILED',
      });
      this.store.markDelivered(claimed, kind, deliveredAt);
      return [{ reminderId: reminder.id, scheduledAt, delivered: true, duplicate: false, kind }];
    }
  }

  private arm(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running) return;
    const next = this.store.nearestNextRunAt();
    if (!next) return;
    const delay = Math.max(0, Math.min(MAX_TIMER_DELAY_MS, Date.parse(next) - this.clock.now()));
    this.timer = setTimeout(() => {
      this.fireDue();
    }, delay);
  }
}

export function schedulerNextLabel(status: SchedulerStatus): string {
  if (!status.healthy) return 'scheduler unavailable';
  if (!status.nextRunAt) return 'scheduler healthy';
  const local = formatZonedTime(Date.parse(status.nextRunAt), status.timezone);
  return `scheduler healthy · next ${local}`;
}

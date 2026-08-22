import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { jarvisDataRoot } from '../edition/resolve';
import { isoUtc } from './clock';
import { AUTOMATION_SCHEMA_VERSION, isReminderStatus } from './constants';
import { computeNextRunAt, isRecurring, nextAfterOccurrence } from './schedule';
import { isValidTimeZone, resolveOwnerTimeZone } from './timezone';
import type {
  JarvisClock,
  OccurrenceStatus,
  PendingDelivery,
  ReminderCreatedFrom,
  ReminderDeliveryMode,
  ReminderOccurrence,
  ReminderRecord,
  ReminderSchedule,
  ReminderStatus,
} from './types';

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  timezone TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  next_run_at TEXT,
  last_run_at TEXT,
  created_from TEXT NOT NULL,
  delivery_mode TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS reminder_occurrences (
  id TEXT PRIMARY KEY,
  reminder_id TEXT NOT NULL,
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL,
  claimed_at TEXT,
  delivered_at TEXT,
  acked_at TEXT,
  delivery_kind TEXT,
  UNIQUE(reminder_id, scheduled_at),
  FOREIGN KEY(reminder_id) REFERENCES reminders(id)
);
CREATE INDEX IF NOT EXISTS idx_reminders_status_next ON reminders(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_occurrences_pending ON reminder_occurrences(status, acked_at);
`;

export function defaultAutomationDbPath(workspaceRoot = process.cwd()): string {
  return path.join(jarvisDataRoot(workspaceRoot), 'automation.db');
}

export class ReminderStore {
  public readonly dbPath: string;
  private readonly db: DatabaseSync;
  private readonly clock: JarvisClock;
  private readonly timezoneOverride?: string;

  constructor(dbPath: string, clock: JarvisClock = { now: () => Date.now() }, options: { timeZone?: string } = {}) {
    this.dbPath = path.resolve(dbPath);
    this.timezoneOverride = options.timeZone;
    if (path.normalize(this.dbPath).includes(`${path.sep}data${path.sep}brain${path.sep}`)) {
      throw new Error('Refusing to open an automation store inside data/brain.');
    }
    if (path.basename(this.dbPath) === 'jarvis.db' || path.basename(this.dbPath) === 'workspace.db') {
      throw new Error('Reminders must not use the canonical memory or workspace database.');
    }
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath, { enableForeignKeyConstraints: true });
    this.db.exec('PRAGMA foreign_keys = ON');
    this.clock = clock;
    this.migrate();
    this.ensureTimezone();
  }

  public close(): void {
    this.db.close();
  }

  public schemaVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
    return Number(row?.version || 0);
  }

  public timezone(): string {
    const row = this.db.prepare("SELECT value FROM automation_settings WHERE key = 'timezone'").get();
    return String(row?.value || resolveOwnerTimeZone());
  }

  public create(input: {
    title: string;
    message: string;
    schedule: ReminderSchedule;
    createdFrom?: ReminderCreatedFrom;
    deliveryMode?: ReminderDeliveryMode;
    metadata?: Record<string, unknown>;
  }): ReminderRecord {
    const computed = computeNextRunAt(input.schedule, this.timezone(), this.clock.now());
    if (!('nextRunAt' in computed)) {
      throw Object.assign(new Error(computed.userMessage), { reasonCode: computed.reasonCode });
    }
    const now = isoUtc(this.clock.now());
    const record: ReminderRecord = {
      id: `rem_${crypto.randomBytes(8).toString('hex')}`,
      title: input.title,
      message: input.message,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      timezone: this.timezone(),
      schedule: input.schedule,
      nextRunAt: isoUtc(computed.nextRunAt),
      lastRunAt: null,
      createdFrom: input.createdFrom ?? 'user_text',
      deliveryMode: input.deliveryMode ?? 'notification',
      revision: 1,
      metadata: input.metadata ?? {},
    };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.insertReminder(record);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return record;
  }

  public get(id: string): ReminderRecord | undefined {
    const row = this.db.prepare('SELECT * FROM reminders WHERE id = ?').get(id);
    return row ? this.rowToReminder(row) : undefined;
  }

  public list(filter: { status?: ReminderStatus | ReminderStatus[]; query?: string } = {}): ReminderRecord[] {
    const rows = this.db.prepare('SELECT * FROM reminders ORDER BY next_run_at IS NULL, next_run_at ASC').all();
    const statuses = filter.status
      ? (Array.isArray(filter.status) ? filter.status : [filter.status])
      : undefined;
    const query = filter.query?.trim().toLocaleLowerCase();
    return rows
      .map(row => this.rowToReminder(row))
      .filter(item => (!statuses || statuses.includes(item.status))
        && (!query || `${item.title} ${item.message}`.toLocaleLowerCase().includes(query) || item.id === filter.query));
  }

  public due(nowMs = this.clock.now()): ReminderRecord[] {
    const now = isoUtc(nowMs);
    return this.db.prepare(
      "SELECT * FROM reminders WHERE status = 'ACTIVE' AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC",
    ).all(now).map(row => this.rowToReminder(row));
  }

  public nearestNextRunAt(): string | null {
    const row = this.db.prepare(
      "SELECT next_run_at FROM reminders WHERE status = 'ACTIVE' AND next_run_at IS NOT NULL ORDER BY next_run_at ASC LIMIT 1",
    ).get();
    return row?.next_run_at ? String(row.next_run_at) : null;
  }

  public setStatus(id: string, status: ReminderStatus, extra: Partial<ReminderRecord> = {}): ReminderRecord | undefined {
    const current = this.get(id);
    if (!current) return undefined;
    const updated: ReminderRecord = {
      ...current,
      ...extra,
      status,
      updatedAt: isoUtc(this.clock.now()),
      revision: current.revision + 1,
    };
    this.updateReminder(updated);
    return updated;
  }

  public claimDue(reminder: ReminderRecord, nowMs = this.clock.now()): ReminderOccurrence | undefined {
    if (reminder.status !== 'ACTIVE' || !reminder.nextRunAt) return undefined;
    const scheduledAt = reminder.nextRunAt;
    const occurrenceId = occurrenceKey(reminder.id, scheduledAt);
    const claimedAt = isoUtc(nowMs);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.db.prepare(
        'SELECT id FROM reminder_occurrences WHERE reminder_id = ? AND scheduled_at = ?',
      ).get(reminder.id, scheduledAt);
      if (existing) {
        this.db.exec('ROLLBACK');
        return undefined;
      }
      this.db.prepare(`
        INSERT INTO reminder_occurrences (
          id, reminder_id, scheduled_at, status, claimed_at, delivered_at, acked_at, delivery_kind
        ) VALUES (?, ?, ?, 'claimed', ?, NULL, NULL, NULL)
      `).run(occurrenceId, reminder.id, scheduledAt, claimedAt);

      const next = isRecurring(reminder.schedule)
        ? nextAfterOccurrence(reminder.schedule, reminder.timezone, Date.parse(scheduledAt))
        : null;
      const nextIso = next ? isoUtc(next) : null;
      const status: ReminderStatus = nextIso ? 'ACTIVE' : 'COMPLETED';
      this.db.prepare(`
        UPDATE reminders
        SET last_run_at = ?, next_run_at = ?, status = ?, updated_at = ?, revision = revision + 1
        WHERE id = ? AND status = 'ACTIVE' AND next_run_at = ?
      `).run(scheduledAt, nextIso, status, claimedAt, reminder.id, scheduledAt);
      this.db.exec('COMMIT');
      return {
        id: occurrenceId,
        reminderId: reminder.id,
        scheduledAt,
        status: 'claimed',
        claimedAt,
        deliveredAt: null,
        ackedAt: null,
        deliveryKind: null,
      };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  public markDelivered(occurrence: ReminderOccurrence, kind: 'on_time' | 'missed', deliveredAt = isoUtc(this.clock.now())): void {
    this.db.prepare(`
      UPDATE reminder_occurrences
      SET status = ?, delivered_at = ?, delivery_kind = ?
      WHERE id = ? AND status = 'claimed'
    `).run(kind === 'missed' ? 'missed' : 'delivered', deliveredAt, kind, occurrence.id);
  }

  public markExpired(id: string): ReminderRecord | undefined {
    return this.setStatus(id, 'EXPIRED', { nextRunAt: null });
  }

  public skipRecurringToNext(reminder: ReminderRecord, nowMs = this.clock.now()): ReminderRecord | undefined {
    const next = computeNextRunAt(reminder.schedule, reminder.timezone, nowMs);
    if (!('nextRunAt' in next)) return this.markExpired(reminder.id);
    const metadata = {
      ...reminder.metadata,
      missedSkipped: true,
    };
    return this.setStatus(reminder.id, 'ACTIVE', {
      nextRunAt: isoUtc(next.nextRunAt),
      metadata,
    });
  }

  public pendingDeliveries(): PendingDelivery[] {
    const rows = this.db.prepare(`
      SELECT o.reminder_id, o.scheduled_at, o.delivery_kind, r.title, r.message, r.timezone, r.schedule_json
      FROM reminder_occurrences o
      JOIN reminders r ON r.id = o.reminder_id
      WHERE o.delivered_at IS NOT NULL AND o.acked_at IS NULL
        AND o.status IN ('delivered', 'missed')
      ORDER BY o.scheduled_at ASC
    `).all();
    return rows.map(row => {
      const schedule = JSON.parse(String(row.schedule_json)) as ReminderSchedule;
      const scheduledMs = Date.parse(String(row.scheduled_at));
      return {
        reminderId: String(row.reminder_id),
        occurrenceAt: String(row.scheduled_at),
        title: String(row.title),
        message: String(row.message),
        scheduledLocal: new Intl.DateTimeFormat('en-GB', {
          timeZone: String(row.timezone),
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        }).format(new Date(scheduledMs)),
        kind: row.delivery_kind === 'missed' ? 'missed' : 'on_time',
        recurrence: schedule.kind,
      };
    });
  }

  public ackOccurrence(
    reminderId: string,
    scheduledAt: string,
    action: 'dismiss' | 'complete',
  ): ReminderOccurrence | undefined {
    const row = this.db.prepare(
      'SELECT * FROM reminder_occurrences WHERE reminder_id = ? AND scheduled_at = ?',
    ).get(reminderId, scheduledAt);
    if (!row) return undefined;
    const ackedAt = isoUtc(this.clock.now());
    const status: OccurrenceStatus = action === 'complete' ? 'completed' : 'dismissed';
    this.db.prepare(
      'UPDATE reminder_occurrences SET status = ?, acked_at = ? WHERE reminder_id = ? AND scheduled_at = ?',
    ).run(status, ackedAt, reminderId, scheduledAt);
    if (action === 'complete') {
      const reminder = this.get(reminderId);
      if (reminder && !isRecurring(reminder.schedule)) {
        this.setStatus(reminderId, 'COMPLETED', { nextRunAt: null });
      }
    }
    return {
      ...this.rowToOccurrence(row),
      status,
      ackedAt,
    };
  }

  public snooze(id: string, minutes: number): ReminderRecord | undefined {
    const reminder = this.get(id);
    if (!reminder || reminder.status !== 'ACTIVE') return undefined;
    const nextRunAt = isoUtc(this.clock.now() + minutes * 60_000);
    return this.setStatus(id, 'ACTIVE', {
      nextRunAt,
      metadata: { ...reminder.metadata, snoozedMinutes: minutes },
    });
  }

  public reschedule(id: string, schedule: ReminderSchedule): ReminderRecord | undefined {
    const reminder = this.get(id);
    if (!reminder) return undefined;
    const computed = computeNextRunAt(schedule, reminder.timezone, this.clock.now());
    if (!('nextRunAt' in computed)) {
      throw Object.assign(new Error(computed.userMessage), { reasonCode: computed.reasonCode });
    }
    return this.setStatus(id, 'ACTIVE', {
      schedule,
      nextRunAt: isoUtc(computed.nextRunAt),
    });
  }

  public resume(id: string): ReminderRecord | undefined {
    const reminder = this.get(id);
    if (!reminder) return undefined;
    const computed = computeNextRunAt(reminder.schedule, reminder.timezone, this.clock.now());
    if (!('nextRunAt' in computed)) {
      return this.setStatus(id, 'EXPIRED', { nextRunAt: null });
    }
    return this.setStatus(id, 'ACTIVE', { nextRunAt: isoUtc(computed.nextRunAt) });
  }

  public hasOccurrence(reminderId: string, scheduledAt: string): boolean {
    return Boolean(
      this.db.prepare(
        'SELECT id FROM reminder_occurrences WHERE reminder_id = ? AND scheduled_at = ?',
      ).get(reminderId, scheduledAt),
    );
  }

  private migrate(): void {
    this.db.exec(SCHEMA_V1);
    const counted = this.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
    if (Number(counted?.n || 0) === 0) {
      this.db.prepare(
        'INSERT INTO schema_migrations(version, applied_at, description) VALUES (?, ?, ?)',
      ).run(AUTOMATION_SCHEMA_VERSION, this.clock.now(), 'Reminders v1 operational store');
    }
  }

  private ensureTimezone(): void {
    const existing = this.db.prepare("SELECT value FROM automation_settings WHERE key = 'timezone'").get();
    if (existing?.value) return;
    this.db.prepare(
      "INSERT INTO automation_settings(key, value) VALUES ('timezone', ?)",
    ).run(this.timezoneOverride && isValidTimeZoneName(this.timezoneOverride)
      ? this.timezoneOverride
      : resolveOwnerTimeZone());
  }

  private insertReminder(record: ReminderRecord): void {
    this.db.prepare(`
      INSERT INTO reminders (
        id, title, message, status, created_at, updated_at, timezone, schedule_json,
        next_run_at, last_run_at, created_from, delivery_mode, revision, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.title,
      record.message,
      record.status,
      record.createdAt,
      record.updatedAt,
      record.timezone,
      JSON.stringify(record.schedule),
      record.nextRunAt,
      record.lastRunAt,
      record.createdFrom,
      record.deliveryMode,
      record.revision,
      JSON.stringify(record.metadata),
    );
  }

  private updateReminder(record: ReminderRecord): void {
    this.db.prepare(`
      UPDATE reminders SET
        title = ?, message = ?, status = ?, updated_at = ?, timezone = ?, schedule_json = ?,
        next_run_at = ?, last_run_at = ?, delivery_mode = ?, revision = ?, metadata_json = ?
      WHERE id = ?
    `).run(
      record.title,
      record.message,
      record.status,
      record.updatedAt,
      record.timezone,
      JSON.stringify(record.schedule),
      record.nextRunAt,
      record.lastRunAt,
      record.deliveryMode,
      record.revision,
      JSON.stringify(record.metadata),
      record.id,
    );
  }

  private rowToReminder(row: Record<string, unknown>): ReminderRecord {
    const status = String(row.status);
    return {
      id: String(row.id),
      title: String(row.title),
      message: String(row.message),
      status: isReminderStatus(status) ? status : 'FAILED',
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      timezone: String(row.timezone),
      schedule: JSON.parse(String(row.schedule_json)) as ReminderSchedule,
      nextRunAt: row.next_run_at ? String(row.next_run_at) : null,
      lastRunAt: row.last_run_at ? String(row.last_run_at) : null,
      createdFrom: String(row.created_from) as ReminderCreatedFrom,
      deliveryMode: String(row.delivery_mode) as ReminderDeliveryMode,
      revision: Number(row.revision),
      metadata: JSON.parse(String(row.metadata_json || '{}')) as Record<string, unknown>,
    };
  }

  private rowToOccurrence(row: Record<string, unknown>): ReminderOccurrence {
    return {
      id: String(row.id),
      reminderId: String(row.reminder_id),
      scheduledAt: String(row.scheduled_at),
      status: String(row.status) as OccurrenceStatus,
      claimedAt: row.claimed_at ? String(row.claimed_at) : null,
      deliveredAt: row.delivered_at ? String(row.delivered_at) : null,
      ackedAt: row.acked_at ? String(row.acked_at) : null,
      deliveryKind: row.delivery_kind === 'missed' || row.delivery_kind === 'on_time'
        ? row.delivery_kind
        : null,
    };
  }
}

export function occurrenceKey(reminderId: string, scheduledAt: string): string {
  return `${reminderId}:${scheduledAt}`;
}

function isValidTimeZoneName(timeZone: string): boolean {
  return isValidTimeZone(timeZone);
}

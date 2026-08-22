import fs from 'node:fs';
import path from 'node:path';
import { jarvisDataRoot } from '../edition/resolve';

export type ReminderAuditEvent = {
  v: 1;
  event:
    | 'created'
    | 'rescheduled'
    | 'cancelled'
    | 'paused'
    | 'resumed'
    | 'completed'
    | 'dismissed'
    | 'snoozed'
    | 'fired'
    | 'delivery_failed'
    | 'expired'
    | 'recovered';
  at: string;
  reminderId: string;
  scheduledAt?: string;
  deliveredAt?: string;
  source: 'scheduler' | 'capability' | 'ui' | 'recovery';
  reasonCode?: string;
  title?: string;
};

export class ReminderAuditLog {
  constructor(private readonly filePath: string) {}

  public record(event: ReminderAuditEvent): void {
    const line = `${JSON.stringify(sanitizeReminderAudit(event))}\n`;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.appendFileSync(this.filePath, line, 'utf8');
  }

  public readAll(): ReminderAuditEvent[] {
    if (!fs.existsSync(this.filePath)) return [];
    return fs.readFileSync(this.filePath, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => JSON.parse(line) as ReminderAuditEvent);
  }
}

export function defaultReminderAuditPath(workspaceRoot = process.cwd()): string {
  return path.join(jarvisDataRoot(workspaceRoot), 'audit', 'reminders.jsonl');
}

export function sanitizeReminderAudit(event: ReminderAuditEvent): ReminderAuditEvent {
  const title = event.title
    ? event.title.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
    : undefined;
  return {
    v: 1,
    event: event.event,
    at: event.at,
    reminderId: event.reminderId,
    source: event.source,
    ...(event.scheduledAt ? { scheduledAt: event.scheduledAt } : {}),
    ...(event.deliveredAt ? { deliveredAt: event.deliveredAt } : {}),
    ...(event.reasonCode ? { reasonCode: event.reasonCode } : {}),
    ...(title ? { title } : {}),
  };
}

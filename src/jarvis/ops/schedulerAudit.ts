/**
 * Scheduler audit. Do not add a competing generic scheduler.
 *
 * Existing:
 * - ReminderScheduler (automation.db) — notification delivery
 * - NightCycle — manual/budgeted consolidation, not cron
 * - ProactiveMonitor — filter with cooldown, not a job runner
 *
 * A scheduled job is NOT permanent permission. Capabilities must be
 * authorized at execution time through CapabilityHost / ActionGate.
 */

export const EXISTING_SCHEDULERS = [
  {
    id: 'reminders',
    module: 'src/jarvis/automation/scheduler.ts',
    store: 'automation.db',
    jobIsPermission: false as const,
    notes: 'Delivers notifications. Recurring reminders do not grant capabilities.',
  },
  {
    id: 'night_cycle',
    module: 'src/jarvis/evolution/nightCycle.ts',
    store: 'evolution.db',
    jobIsPermission: false as const,
    notes: 'Owner/manual or budgeted. Pauses for realtime_voice / owner_task.',
  },
  {
    id: 'proactive_monitor',
    module: 'src/jarvis/monitor',
    store: 'in-memory',
    jobIsPermission: false as const,
    notes: 'Ingest/filter only. Not a cron. Quiet hours + cooldown.',
  },
] as const;

export type SchedulerAuditSnapshot = {
  competingSchedulerAdded: false;
  schedulers: typeof EXISTING_SCHEDULERS;
  jobIsPermanentPermission: false;
};

export function auditSchedulers(): SchedulerAuditSnapshot {
  return {
    competingSchedulerAdded: false,
    schedulers: EXISTING_SCHEDULERS,
    jobIsPermanentPermission: false,
  };
}

export function scheduledJobIsNotPermission(): false {
  return false;
}

export function authorizeAtExecution(input: {
  capabilityId: string;
  grantPresent: boolean;
  leaseValid: boolean;
}): { allowed: boolean; reason: string } {
  if (!input.grantPresent || !input.leaseValid) {
    return { allowed: false, reason: 'Scheduled due-time is not a permission grant.' };
  }
  return { allowed: true, reason: `Capability ${input.capabilityId} authorized at execution.` };
}

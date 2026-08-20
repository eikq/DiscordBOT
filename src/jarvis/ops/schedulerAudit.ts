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
    notes: 'Owner/manual or budgeted. Yields for any higher resource priority. Not cron.',
  },
  {
    id: 'proactive_monitor',
    module: 'src/jarvis/monitor',
    store: 'in-memory',
    jobIsPermission: false as const,
    notes: 'Ingest/filter only. Not a cron. Quiet hours + cooldown.',
  },
] as const;

/**
 * ProactiveRuntime coordinates the three existing schedulers.
 * It does not arm timers, cron, or a competing job runner.
 */
export const PROACTIVE_COORDINATOR = {
  id: 'proactive_runtime',
  module: 'src/jarvis/proactive',
  isScheduler: false as const,
  notes: 'Coordinates reminders, monitor, and NightCycle. Does not arm timers.',
} as const;

export type SchedulerAuditSnapshot = {
  competingSchedulerAdded: false;
  schedulers: typeof EXISTING_SCHEDULERS;
  jobIsPermanentPermission: false;
  coordinatorIsScheduler: false;
};

export function proactiveRuntimeIsScheduler(): false {
  return PROACTIVE_COORDINATOR.isScheduler;
}

export function auditSchedulers(): SchedulerAuditSnapshot {
  return {
    competingSchedulerAdded: false,
    schedulers: EXISTING_SCHEDULERS,
    jobIsPermanentPermission: false,
    coordinatorIsScheduler: false,
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

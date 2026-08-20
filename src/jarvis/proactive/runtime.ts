import type { NightCycleReport } from '../evolution/nightCycle';
import { NIGHT_V2_PIPELINE } from '../evolution/nightCycle';
import type { ProactiveMonitor } from '../monitor/engine';
import {
  auditSchedulers,
  EXISTING_SCHEDULERS,
  PROACTIVE_COORDINATOR,
  proactiveRuntimeIsScheduler,
  type SchedulerAuditSnapshot,
} from '../ops/schedulerAudit';
import { evaluatePreemption, higherResourcePriority } from '../ops/resourcePriority';
import type { ResourcePriority } from '../ops/types';
import { PROACTIVE_NOTICE_POLICY } from './notice';
import {
  nightJobState,
  workTaskJobState,
  type ProactiveJobSnapshot,
} from './jobs';

export type ReminderBoardInput = {
  nextRunAt?: string | null;
  activeCount?: number;
  pendingCount?: number;
  pausedCount?: number;
};

export type OwnerTaskBoardInput = {
  id: string;
  objective: string;
  status: string;
} | null;

export type ProactiveRuntimeOptions = {
  currentPriority?: () => ResourcePriority;
  night?: () => { snapshot(): NightCycleReport };
  monitor?: () => ProactiveMonitor;
  reminders?: () => ReminderBoardInput | undefined;
  ownerTask?: () => OwnerTaskBoardInput;
  simulated?: boolean;
};

export type ProactiveRuntimeSnapshot = {
  currentPriority: ResourcePriority;
  jobs: ProactiveJobSnapshot[];
  noticePolicy: typeof PROACTIVE_NOTICE_POLICY;
  nightV2Pipeline: typeof NIGHT_V2_PIPELINE;
  autoPromoted: false;
  competingSchedulerAdded: false;
  schedulerCount: 3;
  coordinatorIsScheduler: false;
  schedulerAudit: SchedulerAuditSnapshot;
  simulated: true;
  label: 'SIMULATION';
};

/**
 * Coordinates reminders, ProactiveMonitor, and NightCycle.
 * Does not arm timers, cron, or a fourth scheduler.
 */
export class ProactiveRuntime {
  constructor(private readonly options: ProactiveRuntimeOptions = {}) {}

  public currentPriority(): ResourcePriority {
    return this.options.currentPriority?.() ?? 'background_evolution';
  }

  public snapshot(): ProactiveRuntimeSnapshot {
    const jobs = this.jobs();
    return {
      currentPriority: this.currentPriority(),
      jobs,
      noticePolicy: PROACTIVE_NOTICE_POLICY,
      nightV2Pipeline: NIGHT_V2_PIPELINE,
      autoPromoted: false,
      competingSchedulerAdded: false,
      schedulerCount: EXISTING_SCHEDULERS.length,
      coordinatorIsScheduler: proactiveRuntimeIsScheduler(),
      schedulerAudit: auditSchedulers(),
      simulated: true,
      label: 'SIMULATION',
    };
  }

  public jobs(): ProactiveJobSnapshot[] {
    const jobs: ProactiveJobSnapshot[] = [];
    const reminders = this.options.reminders?.();
    if (reminders) {
      const paused = (reminders.pausedCount ?? 0) > 0 && (reminders.activeCount ?? 0) === 0;
      jobs.push({
        id: 'reminder:board',
        kind: 'reminder',
        label: 'Reminders',
        state: paused ? 'paused' : (reminders.pendingCount ?? 0) > 0 ? 'running' : 'scheduled',
        priority: 'scheduled_action',
        ...(reminders.nextRunAt ? { nextDueAt: reminders.nextRunAt } : {}),
      });
    }
    const monitor = this.options.monitor?.();
    if (monitor) {
      const snap = monitor.snapshot();
      jobs.push({
        id: 'monitor:proactive',
        kind: 'monitor',
        label: 'Proactive monitor',
        state: snap.pendingCount > 0 ? 'waiting' : 'scheduled',
        priority: 'monitoring',
      });
    }
    const night = this.options.night?.().snapshot();
    if (night) {
      jobs.push({
        id: 'night:cycle',
        kind: 'night',
        label: night.v2Stage ? `Night ${night.v2Stage}` : 'Night cycle',
        state: nightJobState(night.status),
        priority: 'background_evolution',
        ...(night.pausedFor ? { pausedFor: night.pausedFor } : {}),
      });
    }
    const task = this.options.ownerTask?.() ?? null;
    if (task) {
      jobs.push({
        id: `task:${task.id}`,
        kind: 'owner_task',
        label: task.objective,
        state: workTaskJobState(task.status),
        priority: 'owner_task',
      });
    }
    return jobs;
  }
}

export function combineResourcePriority(
  voice: ResourcePriority,
  ownerTaskActive: boolean,
): ResourcePriority {
  if (!ownerTaskActive) return voice;
  return higherResourcePriority(voice, 'owner_task');
}

export { evaluatePreemption, PROACTIVE_COORDINATOR };

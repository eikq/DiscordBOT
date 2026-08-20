export const PROACTIVE_JOB_STATES = [
  'scheduled',
  'running',
  'paused',
  'yielded',
  'waiting',
  'completed',
] as const;

export type ProactiveJobState = (typeof PROACTIVE_JOB_STATES)[number];

export type ProactiveJobKind = 'reminder' | 'monitor' | 'night' | 'owner_task';

export type ProactiveJobSnapshot = {
  id: string;
  kind: ProactiveJobKind;
  label: string;
  state: ProactiveJobState;
  priority: 'realtime_voice' | 'owner_task' | 'scheduled_action' | 'monitoring' | 'background_evolution';
  nextDueAt?: string;
  pausedFor?: string;
};

export function workTaskJobState(status: string): ProactiveJobState {
  if (status === 'WAITING_PERMISSION') return 'waiting';
  if (status === 'PAUSED') return 'paused';
  if (
    status === 'EXECUTING'
    || status === 'OBSERVING'
    || status === 'ADAPTING'
    || status === 'VERIFYING'
    || status === 'UNDERSTANDING'
    || status === 'PLANNING'
  ) {
    return 'running';
  }
  if (
    status === 'COMPLETED'
    || status === 'FAILED'
    || status === 'CANCELLED'
    || status === 'BLOCKED'
    || status === 'DEGRADED'
  ) {
    return 'completed';
  }
  return 'scheduled';
}

export function nightJobState(status: string): ProactiveJobState {
  if (status === 'running') return 'running';
  if (status === 'yielded') return 'yielded';
  if (status === 'paused') return 'paused';
  if (status === 'waiting') return 'waiting';
  if (status === 'completed' || status === 'cancelled') return 'completed';
  return 'scheduled';
}

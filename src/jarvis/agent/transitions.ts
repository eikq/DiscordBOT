import type { WorkTaskStatus } from './types';

const EDGES: Record<WorkTaskStatus, WorkTaskStatus[]> = {
  RECEIVED: ['UNDERSTANDING', 'CANCELLED'],
  UNDERSTANDING: ['PLANNING', 'WAITING_INPUT', 'BLOCKED', 'FAILED', 'CANCELLED'],
  PLANNING: ['READY', 'FAILED', 'CANCELLED'],
  READY: ['EXECUTING', 'WAITING_PERMISSION', 'PAUSED', 'CANCELLED'],
  EXECUTING: ['OBSERVING', 'WAITING_PERMISSION', 'ADAPTING', 'BLOCKED', 'FAILED', 'PAUSED', 'CANCELLED', 'DEGRADED'],
  OBSERVING: ['ADAPTING', 'VERIFYING', 'FAILED', 'CANCELLED'],
  ADAPTING: ['READY', 'EXECUTING', 'BLOCKED', 'FAILED', 'CANCELLED'],
  VERIFYING: ['COMPLETED', 'FAILED', 'DEGRADED', 'CANCELLED'],
  WAITING_INPUT: ['PLANNING', 'BLOCKED', 'CANCELLED', 'EXPIRED'],
  WAITING_PERMISSION: ['READY', 'EXECUTING', 'BLOCKED', 'CANCELLED', 'PAUSED'],
  PAUSED: ['READY', 'EXECUTING', 'CANCELLED'],
  BLOCKED: ['CANCELLED'],
  FAILED: [],
  COMPLETED: [],
  CANCELLED: [],
  DEGRADED: ['COMPLETED', 'CANCELLED'],
  EXPIRED: [],
};

export const TERMINAL_TASK_STATUSES: ReadonlySet<WorkTaskStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BLOCKED',
  'EXPIRED',
]);

export function canTransition(from: WorkTaskStatus, to: WorkTaskStatus): boolean {
  if (from === to) return true;
  return EDGES[from].includes(to);
}

export function assertTransition(from: WorkTaskStatus, to: WorkTaskStatus): void {
  if (!canTransition(from, to)) {
    throw Object.assign(new Error(`Invalid task transition ${from} → ${to}.`), { reasonCode: 'PLAN_INVALID' });
  }
}

export function isTerminalStatus(status: WorkTaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.has(status);
}

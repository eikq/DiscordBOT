import type { PlanStep, WorkTask } from './types';

export function sanitizeTaskForPersist(task: WorkTask): WorkTask {
  return {
    ...task,
    plan: task.plan.map(sanitizeStepForPersist),
  };
}

export function sanitizeStepForPersist(step: PlanStep): PlanStep {
  const next: PlanStep = { ...step };
  if (next.permissionLease) {
    const { token: _token, ...lease } = next.permissionLease;
    next.permissionLease = { ...lease, token: undefined };
  }
  return next;
}

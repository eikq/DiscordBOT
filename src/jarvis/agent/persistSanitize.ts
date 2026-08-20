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
  if (next.pendingConfirmation) {
    const pending = { ...next.pendingConfirmation } as Record<string, unknown>;
    delete pending.token;
    delete pending.confirmToken;
    delete pending.confirmationToken;
    next.pendingConfirmation = pending as PlanStep['pendingConfirmation'];
  }
  return next;
}

import { DEFAULT_BUDGETS, type JarvisBudgets } from './types';

export function mergeBudgets(overrides: Partial<JarvisBudgets> = {}): JarvisBudgets {
  return {
    taskSteps: clamp(overrides.taskSteps ?? DEFAULT_BUDGETS.taskSteps, 1, 64),
    researchPages: clamp(overrides.researchPages ?? DEFAULT_BUDGETS.researchPages, 1, 16),
    researchTimeMs: clamp(overrides.researchTimeMs ?? DEFAULT_BUDGETS.researchTimeMs, 1_000, 180_000),
    retries: clamp(overrides.retries ?? DEFAULT_BUDGETS.retries, 0, 6),
    reflectionCount: clamp(overrides.reflectionCount ?? DEFAULT_BUDGETS.reflectionCount, 0, 32),
    nightCycleRuntimeMs: clamp(overrides.nightCycleRuntimeMs ?? DEFAULT_BUDGETS.nightCycleRuntimeMs, 1_000, 30 * 60_000),
    practiceTasks: clamp(overrides.practiceTasks ?? DEFAULT_BUDGETS.practiceTasks, 0, 24),
    eventBuffer: clamp(overrides.eventBuffer ?? DEFAULT_BUDGETS.eventBuffer, 20, 500),
  };
}

export function remainingBudget(used: number, max: number): number {
  return Math.max(0, max - used);
}

export function budgetExceeded(used: number, max: number): boolean {
  return used >= max;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

import { classifyFailure, isRetryableError } from '../ops/errors';
import type { JarvisErrorCode } from '../ops/types';
import type { PlanStep, WorkTask } from './types';

export function canRetry(step: PlanStep, task: WorkTask, code: JarvisErrorCode): boolean {
  if (task.retryBudget - task.retriesUsed <= 0) return false;
  if (step.retryPolicy.attempted >= step.retryPolicy.maxAttempts) return false;
  return isRetryableError(code);
}

export function failureSignature(input: {
  domain?: string;
  tool?: string;
  errorClass: JarvisErrorCode | string;
  stage?: string;
  environment?: string;
  symptoms?: string;
}): string {
  return [
    input.domain || 'general',
    input.tool || 'none',
    String(input.errorClass),
    input.stage || 'unknown',
    input.environment || 'cloud',
    (input.symptoms || '').toLowerCase().replace(/\s+/gu, ' ').trim().slice(0, 48),
  ].join('|');
}

export function classifyStepFailure(step: PlanStep, message: string, reasonCode?: string): JarvisErrorCode {
  return classifyFailure({ reasonCode, message, stage: step.kind });
}

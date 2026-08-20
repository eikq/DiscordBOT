import { sanitizeTaskForPersist } from './persistSanitize';
import type { WorkTask } from './types';

export function recoverInterruptedTask(task: WorkTask): WorkTask {
  const sanitized = sanitizeTaskForPersist(task);
  const next: WorkTask = {
    ...sanitized,
    plan: sanitized.plan.map(step => {
      if (step.status !== 'running') return { ...step };
      if (step.kind === 'apply' && step.riskLevel !== 'LOW') {
        return {
          ...step,
          status: 'failed' as const,
          errorCode: step.errorCode || 'STEP_FAILED',
          resultSummary: step.resultSummary || 'Interrupted during a mutating step; not automatically retried.',
        };
      }
      return { ...step, status: 'pending' as const };
    }),
  };
  return next;
}

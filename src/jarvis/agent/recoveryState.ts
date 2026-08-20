import type { WorkTask } from './types';

export function recoverInterruptedTask(task: WorkTask): WorkTask {
  const next: WorkTask = {
    ...task,
    plan: task.plan.map(step => {
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

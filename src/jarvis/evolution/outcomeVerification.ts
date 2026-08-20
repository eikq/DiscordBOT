import type { WorkTask } from '../agent/types';
import type { ExperienceOutcome } from './types';
import { classifyFailureKnowledge } from './failureKinds';
import type { FailureKnowledgeKind } from './types';

export type VerifiedTaskOutcome = {
  outcome: ExperienceOutcome;
  verified: boolean;
  cause?: string;
  failureKind?: FailureKnowledgeKind;
  summary: string;
};

export function verifyTaskOutcome(task: WorkTask): VerifiedTaskOutcome {
  const claimed = task.outcome === 'success'
    ? 'success'
    : task.outcome === 'cancelled'
      ? 'partial'
      : task.outcome === 'degraded'
        ? 'partial'
        : 'failure';
  const summary = task.verification?.summary || task.errors[0]?.message || task.outcome || task.status;
  if (task.verification && task.verification.passed === false) {
    return {
      outcome: 'failure',
      verified: false,
      cause: task.errors[0]?.code || 'VERIFICATION_FAILED',
      failureKind: 'verification_failed',
      summary,
    };
  }
  if (claimed !== 'success') {
    const cause = task.errors[0]?.code || task.status;
    return {
      outcome: claimed,
      verified: false,
      cause,
      failureKind: classifyFailureKnowledge(cause, summary),
      summary,
    };
  }
  if (task.status === 'FAILED' || task.status === 'BLOCKED') {
    const cause = task.errors[0]?.code || task.status;
    return {
      outcome: 'failure',
      verified: false,
      cause,
      failureKind: classifyFailureKnowledge(cause, summary),
      summary,
    };
  }
  return {
    outcome: 'success',
    verified: true,
    summary,
  };
}

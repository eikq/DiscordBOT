import type { ProjectCommandEvidence } from './types';
import type { ProjectFailureClass } from './types';

export function classifyProjectFailure(evidence: Pick<ProjectCommandEvidence, 'commandType' | 'exitCode' | 'stderrSummary' | 'stdoutSummary'>): ProjectFailureClass {
  if (evidence.exitCode === 0) return 'UNKNOWN';
  if (evidence.commandType === 'npm-install' || evidence.commandType === 'npm-ci') return 'DEPENDENCY';
  if (evidence.commandType === 'npm-run' && /build/iu.test(evidence.stdoutSummary + evidence.stderrSummary)) return 'BUILD';
  if (evidence.commandType === 'node-test' || /test|assert/iu.test(evidence.stderrSummary)) return 'TEST';
  if (/typescript|syntaxerror|cannot find module/iu.test(evidence.stderrSummary)) return 'TYPE';
  if (evidence.commandType === 'npm-run') return 'BUILD';
  return 'UNKNOWN';
}

export function correctionProposalFromFailure(input: {
  evidence: ProjectCommandEvidence;
  workspace: string;
}): { summary: string; bounded: true; retryMutation: false; failureClass: ProjectFailureClass } {
  const failureClass = classifyProjectFailure(input.evidence);
  return {
    summary: `${failureClass} failed with exit ${input.evidence.exitCode ?? 'none'}: ${input.evidence.stderrSummary || input.evidence.stdoutSummary || 'no output'}`,
    bounded: true,
    retryMutation: false,
    failureClass,
  };
}

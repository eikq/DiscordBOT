import type { JarvisErrorCode } from './types';

export type JarvisStructuredError = {
  code: JarvisErrorCode;
  message: string;
  retryable: boolean;
  degraded?: boolean;
  simulated?: boolean;
};

const RETRYABLE: ReadonlySet<JarvisErrorCode> = new Set([
  'PROVIDER_UNAVAILABLE',
  'RESEARCH_TIMEOUT',
  'RESOURCE_PRESSURE',
  'STEP_FAILED',
]);

export function jarvisError(
  code: JarvisErrorCode,
  message: string,
  extra: { degraded?: boolean; simulated?: boolean } = {},
): JarvisStructuredError {
  return {
    code,
    message,
    retryable: RETRYABLE.has(code),
    ...extra,
  };
}

export function isRetryableError(code: JarvisErrorCode): boolean {
  return RETRYABLE.has(code);
}

export function classifyFailure(input: {
  reasonCode?: string;
  message?: string;
  stage?: string;
}): JarvisErrorCode {
  const hay = `${input.reasonCode || ''} ${input.message || ''}`.toLowerCase();
  if (/cancel/u.test(hay)) return 'CANCELLED';
  if (/permission|privilege|confirm/u.test(hay)) return 'PERMISSION_REQUIRED';
  if (/denied|forbidden|blocked/u.test(hay)) return 'CAPABILITY_DENIED';
  if (/timeout|timed out/u.test(hay)) return 'RESEARCH_TIMEOUT';
  if (/cycle|circular/u.test(hay)) return 'DEPENDENCY_CYCLE';
  if (/budget|retry/u.test(hay)) return 'BUDGET_EXCEEDED';
  if (/verif/u.test(hay)) return 'VERIFICATION_FAILED';
  if (/unavailable|offline|missing/u.test(hay)) return 'PROVIDER_UNAVAILABLE';
  if (/pressure|vram|busy/u.test(hay)) return 'RESOURCE_PRESSURE';
  if (/local.?accept|whonix|virtualbox|gpu/u.test(hay)) return 'LOCAL_ACCEPTANCE_REQUIRED';
  if (/plan|invalid/u.test(hay)) return 'PLAN_INVALID';
  if (/conflict|supersed/u.test(hay)) return 'MEMORY_CONFLICT';
  return 'STEP_FAILED';
}

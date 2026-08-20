import {
  DISTINCT_FAILURE_CODES,
  type DistinctFailureCode,
  type JarvisErrorCode,
} from './types';

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
  'TIMEOUT',
  'RESOURCE_PRESSURE',
  'STEP_FAILED',
]);

const KNOWN_CODES: ReadonlySet<string> = new Set([
  ...DISTINCT_FAILURE_CODES,
  'CAPABILITY_DENIED',
  'RESEARCH_TIMEOUT',
  'MEMORY_CONFLICT',
  'PLAN_INVALID',
  'STEP_FAILED',
  'RESOURCE_PRESSURE',
  'LOCAL_ACCEPTANCE_REQUIRED',
  'CANCELLED',
  'BUDGET_EXCEEDED',
  'DEPENDENCY_CYCLE',
  'SIMULATION_ONLY',
]);

/** Aliases that must not collapse into STEP_FAILED. */
const REASON_ALIASES: Record<string, JarvisErrorCode> = {
  SELF_APPROVAL_DENIED: 'DENIED',
  PROPOSAL_DENIED: 'DENIED',
  UNTRUSTED_ACTOR: 'DENIED',
  ANALYZER_INSUFFICIENT: 'INSUFFICIENT_DATA',
  NATIVE_UNAVAILABLE: 'UNSUPPORTED_HOST',
  HELPER_UNAVAILABLE: 'UNSUPPORTED_HOST',
  TIMED_OUT: 'TIMEOUT',
};

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

export function isDistinctFailureCode(code: string): code is DistinctFailureCode {
  return (DISTINCT_FAILURE_CODES as readonly string[]).includes(code);
}

export function classifyFailure(input: {
  reasonCode?: string;
  message?: string;
  stage?: string;
}): JarvisErrorCode {
  const exact = normalizeReason(input.reasonCode);
  if (exact) return exact;

  const hay = `${input.reasonCode || ''} ${input.message || ''} ${input.stage || ''}`.toLowerCase();
  if (/cancel/u.test(hay)) return 'CANCELLED';
  if (/unsupported.?host|native helper|helper is not installed/u.test(hay)) return 'UNSUPPORTED_HOST';
  if (/unknown.?display/u.test(hay)) return 'UNKNOWN_DISPLAY';
  if (/insufficient.?data/u.test(hay)) return 'INSUFFICIENT_DATA';
  if (/permission|privilege|confirm/u.test(hay)) return 'PERMISSION_REQUIRED';
  if (/denied|forbidden|blocked/u.test(hay)) return 'CAPABILITY_DENIED';
  if (/timeout|timed out/u.test(hay)) {
    if (input.stage === 'research' || /research/u.test(hay)) return 'RESEARCH_TIMEOUT';
    return 'TIMEOUT';
  }
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

function normalizeReason(reasonCode?: string): JarvisErrorCode | undefined {
  const key = String(reasonCode || '').trim().toUpperCase().replace(/[\s-]+/gu, '_');
  if (!key) return undefined;
  if (KNOWN_CODES.has(key)) return key as JarvisErrorCode;
  return REASON_ALIASES[key];
}

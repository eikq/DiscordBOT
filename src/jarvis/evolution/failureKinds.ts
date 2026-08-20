import type { JarvisErrorCode } from '../ops/types';
import type { FailureKnowledgeKind } from './types';

export const FAILURE_KNOWLEDGE_KINDS = [
  'capability_unavailable',
  'provider_timeout',
  'unsupported_host',
  'known_bad_plan',
  'owner_denied',
  'verification_failed',
] as const satisfies readonly FailureKnowledgeKind[];

export function classifyFailureKnowledge(
  errorClass: JarvisErrorCode | string = 'STEP_FAILED',
  cause?: string,
): FailureKnowledgeKind {
  const hay = `${errorClass} ${cause || ''}`.toLowerCase();
  if (errorClass === 'VERIFICATION_FAILED' || /verif/u.test(hay)) return 'verification_failed';
  if (
    errorClass === 'DENIED'
    || errorClass === 'CAPABILITY_DENIED'
    || errorClass === 'PERMISSION_REQUIRED'
    || /permission|denied|forbidden|blocked|owner/u.test(hay)
  ) return 'owner_denied';
  if (
    errorClass === 'TIMEOUT'
    || errorClass === 'RESEARCH_TIMEOUT'
    || /timeout|timed out|research_timeout/u.test(hay)
  ) return 'provider_timeout';
  if (
    errorClass === 'UNSUPPORTED_HOST'
    || errorClass === 'UNKNOWN_DISPLAY'
    || errorClass === 'LOCAL_ACCEPTANCE_REQUIRED'
    || /local.?accept|whonix|virtualbox|unsupported.?host|unknown.?display/u.test(hay)
  ) return 'unsupported_host';
  if (errorClass === 'PROVIDER_UNAVAILABLE' || /unavailable|not_installed|offline|missing/u.test(hay)) {
    return 'capability_unavailable';
  }
  if (errorClass === 'PLAN_INVALID' || /plan_invalid|known.?bad|bad.?plan/u.test(hay)) return 'known_bad_plan';
  return 'known_bad_plan';
}

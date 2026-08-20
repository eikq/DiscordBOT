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
  if (/verif/u.test(hay)) return 'verification_failed';
  if (/permission|denied|forbidden|blocked|owner/u.test(hay)) return 'owner_denied';
  if (/timeout|timed out|research_timeout/u.test(hay)) return 'provider_timeout';
  if (/unavailable|not_installed|offline|missing/u.test(hay)) return 'capability_unavailable';
  if (/local.?accept|whonix|virtualbox|unsupported.?host/u.test(hay)) return 'unsupported_host';
  if (/plan_invalid|known.?bad|bad.?plan/u.test(hay)) return 'known_bad_plan';
  if (errorClass === 'PROVIDER_UNAVAILABLE') return 'capability_unavailable';
  if (errorClass === 'RESEARCH_TIMEOUT') return 'provider_timeout';
  if (errorClass === 'CAPABILITY_DENIED' || errorClass === 'PERMISSION_REQUIRED') return 'owner_denied';
  if (errorClass === 'VERIFICATION_FAILED') return 'verification_failed';
  if (errorClass === 'LOCAL_ACCEPTANCE_REQUIRED') return 'unsupported_host';
  if (errorClass === 'PLAN_INVALID') return 'known_bad_plan';
  return 'known_bad_plan';
}

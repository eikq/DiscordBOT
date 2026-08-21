import type { CapabilityDescriptor, CapabilityResult } from '../capabilities/types';
import type { RollbackContract, VerificationRecord } from './types';

export function verificationForResult(
  descriptor: CapabilityDescriptor,
  result: CapabilityResult,
  now: number = Date.now(),
): VerificationRecord {
  const spec = descriptor.verification;
  if (result.status !== 'ok') {
    return {
      state: 'FAILED_VERIFICATION',
      strategy: spec?.description || 'Capability result status check.',
      requested: descriptor.description,
      executed: result.error || result.status,
      evidence: [],
      failedChecks: [`Capability returned ${result.status}.`],
      verifiedAt: new Date(now).toISOString(),
    };
  }

  if (spec?.mode === 'structured_postcondition' && spec.structuredField) {
    const actual = readPath(result.structured, spec.structuredField);
    const passed = deepEqual(actual, spec.expectedValue);
    return {
      state: passed ? 'VERIFIED' : 'FAILED_VERIFICATION',
      strategy: spec.description,
      requested: descriptor.description,
      executed: `Checked structured postcondition ${spec.structuredField}.`,
      evidence: passed ? [`${spec.structuredField} matched the expected value.`] : [],
      failedChecks: passed ? [] : [`${spec.structuredField} did not match the expected value.`],
      verifiedAt: new Date(now).toISOString(),
    };
  }

  if (spec?.mode === 'not_applicable' || (!spec && descriptor.sideEffect === 'read')) {
    return {
      state: 'NOT_APPLICABLE',
      strategy: spec?.description || 'Read-only capability; no mutation postcondition applies.',
      requested: descriptor.description,
      executed: 'Capability result recorded.',
      evidence: [],
      failedChecks: [],
      verifiedAt: new Date(now).toISOString(),
    };
  }

  if (spec?.mode === 'handler_result') {
    return {
      state: 'PARTIALLY_VERIFIED',
      strategy: spec.description,
      requested: descriptor.description,
      executed: 'Typed handler reported completion; no independent postcondition was executed.',
      evidence: ['Typed capability handler returned status ok.'],
      failedChecks: [],
      verifiedAt: new Date(now).toISOString(),
    };
  }

  return {
    state: 'UNVERIFIED',
    strategy: 'No postcondition strategy is registered for this mutation.',
    requested: descriptor.description,
    executed: 'Typed handler returned status ok.',
    evidence: [],
    failedChecks: [],
    verifiedAt: new Date(now).toISOString(),
  };
}

export function rollbackForResult(
  descriptor: CapabilityDescriptor,
  result: CapabilityResult,
): RollbackContract {
  const spec = descriptor.rollback;
  if (!spec) return { state: 'UNAVAILABLE', strategy: 'No rollback contract is registered.' };
  if (spec.mode === 'not_required') return { state: 'NOT_REQUIRED', strategy: spec.strategy };

  const checkpointId = spec.checkpointField
    ? safeReference(readPath(result.structured, spec.checkpointField))
    : undefined;
  const priorStateReference = spec.priorStateField
    ? safeReference(readPath(result.structured, spec.priorStateField))
    : undefined;
  if (spec.mode === 'recorded_checkpoint' && checkpointId) {
    return {
      state: 'AVAILABLE',
      strategy: spec.strategy,
      checkpointId,
      ...(priorStateReference ? { priorStateReference } : {}),
      ...(spec.recoveryInstructions ? { recoveryInstructions: spec.recoveryInstructions } : {}),
    };
  }
  if (spec.mode === 'manual_recovery' && priorStateReference) {
    return {
      state: 'PARTIAL',
      strategy: spec.strategy,
      priorStateReference,
      ...(spec.recoveryInstructions ? { recoveryInstructions: spec.recoveryInstructions } : {}),
    };
  }
  return {
    state: 'UNAVAILABLE',
    strategy: `${spec.strategy} No required checkpoint or prior-state record was produced.`,
    ...(spec.recoveryInstructions ? { recoveryInstructions: spec.recoveryInstructions } : {}),
  };
}

function readPath(value: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, value);
}

function safeReference(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return value.trim().slice(0, 512);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

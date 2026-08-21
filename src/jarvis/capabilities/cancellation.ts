import type {
  CapabilityCancellationReason,
  CapabilityCancellationRecord,
  CapabilityCancellationSupport,
  CapabilityResult,
} from './types';

const CANCELLATION_REASON = Symbol('jarvis-capability-cancellation');

export type JarvisAbortReason = {
  [CANCELLATION_REASON]: true;
  reason: CapabilityCancellationReason;
  requestedAt: string;
};

export function createAbortReason(
  reason: CapabilityCancellationReason,
  now: number = Date.now(),
): JarvisAbortReason {
  return { [CANCELLATION_REASON]: true, reason, requestedAt: new Date(now).toISOString() };
}

export function readAbortReason(signal: AbortSignal): JarvisAbortReason | undefined {
  const value = signal.reason;
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<JarvisAbortReason>;
  return candidate[CANCELLATION_REASON] === true
    && isCancellationReason(candidate.reason)
    && typeof candidate.requestedAt === 'string'
    ? candidate as JarvisAbortReason
    : undefined;
}

export function cancelledCapabilityResult(input: {
  capabilityId: string;
  sideEffect: CapabilityResult['sideEffect'];
  untrustedOutput: boolean;
  signal: AbortSignal;
  detail?: string;
}): CapabilityResult {
  const reason = readAbortReason(input.signal) ?? createAbortReason('OWNER_CANCEL');
  const cancellation: CapabilityCancellationRecord = {
    support: 'cooperative',
    state: 'CANCELLED',
    reason: reason.reason,
    requestedAt: reason.requestedAt,
    completedAt: new Date().toISOString(),
    observedByHandler: true,
    detail: input.detail ?? 'The typed handler observed cancellation and stopped before commit.',
  };
  return {
    capabilityId: input.capabilityId,
    status: 'cancelled',
    structured: { status: 'cancelled', cancellation },
    content: cancellation.detail,
    sourceUrls: [],
    untrustedOutput: input.untrustedOutput,
    sideEffect: input.sideEffect,
    error: reason.reason,
  };
}

export function cancellationSupportOf(value: CapabilityCancellationSupport | undefined): CapabilityCancellationSupport {
  return value === 'cooperative' ? value : 'not_supported';
}

function isCancellationReason(value: unknown): value is CapabilityCancellationReason {
  return value === 'OWNER_CANCEL' || value === 'EMERGENCY_STOP' || value === 'TIMEOUT';
}

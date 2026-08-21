import type { ToolResultRef } from '../core/types';
import type {
  CapabilityCancellationRecord,
  CapabilityAvailabilityState,
  CapabilityDescriptor,
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvokeRequest,
  CapabilityResult,
} from './types';
import { cancellationSupportOf, createAbortReason, readAbortReason } from './cancellation';

const TIMEOUT_CODE = 'CAPABILITY_TIMEOUT';

/**
 * Minimal typed registry. Core calls this host; it does not know the provider.
 */
export class CapabilityRegistry implements CapabilityHost {
  private readonly handlers = new Map<string, CapabilityHandler>();

  public register(handler: CapabilityHandler): void {
    const descriptor = handler.descriptor();
    if (this.handlers.has(descriptor.id)) {
      throw new Error(`Capability ${descriptor.id} is already registered.`);
    }
    this.handlers.set(descriptor.id, handler);
  }

  public lookup(id: string): CapabilityDescriptor | undefined {
    const handler = this.handlers.get(id);
    if (!handler) return undefined;
    return cloneDescriptor(handler.descriptor());
  }

  public list(): CapabilityDescriptor[] {
    return [...this.handlers.values()].map(handler => cloneDescriptor(handler.descriptor()));
  }

  public async availability(id: string): Promise<CapabilityAvailabilityState> {
    const handler = this.handlers.get(id);
    if (!handler) {
      return {
        id,
        availability: 'unavailable',
        degraded: true,
        reason: `Capability ${id} is not registered.`,
      };
    }
    return handler.availability();
  }

  public async invoke(request: CapabilityInvokeRequest): Promise<CapabilityResult> {
    const handler = this.handlers.get(request.id);
    if (!handler) {
      return unavailableResult(request.id, `Capability ${request.id} is not registered.`);
    }
    const descriptor = handler.descriptor();
    const timeoutMs = request.timeoutMs ?? descriptor.timeoutMs;
    const controller = new AbortController();
    const support = cancellationSupportOf(descriptor.cancellation?.support);
    const removeForwarder = forwardAbort(request.signal, controller);
    try {
      const payload = request.confirmation
        ? { ...request.input, confirmation: request.confirmation }
        : request.input;
      if (controller.signal.aborted) {
        return cancellationBeforeStart(request.id, descriptor.sideEffect, descriptor.untrustedOutput, support, controller.signal);
      }
      const invoked = Promise.resolve(handler.invoke(payload, {
        signal: controller.signal,
        requestId: request.requestId,
        sessionId: request.sessionId,
        source: request.source,
      }));
      const result = await withTimeout(invoked, timeoutMs, request.id, controller);
      return decorateCancellation(result, support, controller.signal);
    } catch (error) {
      if (isTimeoutError(error)) {
        return timeoutResult(request.id, timeoutMs, descriptor.sideEffect, descriptor.untrustedOutput, support, controller.signal);
      }
      const message = error instanceof Error ? error.message : String(error);
      const failure: CapabilityResult = {
        capabilityId: request.id,
        status: 'error',
        structured: { status: 'error', error: message },
        content: '',
        sourceUrls: [],
        untrustedOutput: descriptor.untrustedOutput,
        sideEffect: descriptor.sideEffect,
        error: message,
      };
      return decorateCancellation(failure, support, controller.signal);
    } finally {
      removeForwarder();
    }
  }
}

export function capabilityResultToToolRef(result: CapabilityResult): ToolResultRef {
  const status: ToolResultRef['status'] = result.status === 'ok'
    ? 'ok'
    : result.status === 'error' || result.status === 'rejected' || result.status === 'cancelled'
      ? 'error'
      : 'unavailable';
  const summary = result.status === 'ok'
    ? (result.untrustedOutput ? 'untrusted external data' : 'ok')
    : result.status === 'confirmation_required'
      ? 'permission required'
      : result.status === 'rejected'
        ? (result.error || 'denied')
        : result.status === 'cancelled'
          ? 'cancelled'
        : (result.error || result.status);
  return {
    toolName: result.capabilityId,
    status,
    ...(result.sourceUrls.length > 0 ? { sourceUrls: result.sourceUrls } : {}),
    summary,
  };
}

function cloneDescriptor(descriptor: CapabilityDescriptor): CapabilityDescriptor {
  return {
    ...descriptor,
    inputSchema: { ...descriptor.inputSchema },
    outputSchema: { ...descriptor.outputSchema },
    ...(descriptor.effects
      ? {
          effects: descriptor.effects.map(effect => ({
            ...effect,
            ...(effect.targets ? { targets: [...effect.targets] } : {}),
            ...(effect.targetInputFields ? { targetInputFields: [...effect.targetInputFields] } : {}),
          })),
        }
      : {}),
    ...(descriptor.verification ? { verification: { ...descriptor.verification } } : {}),
    ...(descriptor.rollback ? { rollback: { ...descriptor.rollback } } : {}),
    ...(descriptor.cancellation ? { cancellation: { ...descriptor.cancellation } } : {}),
  };
}

function unavailableResult(id: string, error: string): CapabilityResult {
  return {
    capabilityId: id,
    status: 'unavailable',
    structured: { status: 'unavailable', error },
    content: '',
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'read',
    error,
  };
}

function timeoutResult(
  id: string,
  timeoutMs: number,
  sideEffect: CapabilityResult['sideEffect'],
  untrustedOutput: boolean,
  support: 'cooperative' | 'not_supported',
  signal: AbortSignal,
): CapabilityResult {
  const error = `Capability ${id} timed out after ${timeoutMs}ms.`;
  return {
    capabilityId: id,
    status: 'timeout',
    structured: {
      status: 'timeout',
      error,
      cancellation: cancellationRecord(
        support,
        support === 'cooperative' ? 'CANCELLATION_REQUESTED' : 'NOT_CANCELLABLE',
        signal,
        support === 'cooperative'
          ? 'Timeout signalled the cooperative handler; its final acknowledgement is not yet known.'
          : 'The handler does not support cooperative cancellation; its final effect is unknown.',
        false,
      ),
    },
    content: '',
    sourceUrls: [],
    untrustedOutput,
    sideEffect,
    error,
  };
}

function withTimeout(
  promise: Promise<CapabilityResult>,
  timeoutMs: number,
  id: string,
  controller: AbortController,
): Promise<CapabilityResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort(createAbortReason('TIMEOUT'));
      promise.catch(() => undefined);
      reject(Object.assign(new Error(`Capability ${id} timed out after ${timeoutMs}ms.`), { code: TIMEOUT_CODE }));
    }, timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => undefined;
  const forward = () => {
    if (!target.signal.aborted) {
      target.abort(readAbortReason(source) ?? createAbortReason('OWNER_CANCEL'));
    }
  };
  if (source.aborted) forward();
  else source.addEventListener('abort', forward, { once: true });
  return () => source.removeEventListener('abort', forward);
}

function cancellationBeforeStart(
  capabilityId: string,
  sideEffect: CapabilityResult['sideEffect'],
  untrustedOutput: boolean,
  support: 'cooperative' | 'not_supported',
  signal: AbortSignal,
): CapabilityResult {
  const cancellation = cancellationRecord(
    support,
    'CANCELLED',
    signal,
    'CapabilityHost observed cancellation before the handler started.',
    false,
  );
  return {
    capabilityId,
    status: 'cancelled',
    structured: { status: 'cancelled', cancellation },
    content: cancellation.detail,
    sourceUrls: [],
    untrustedOutput,
    sideEffect,
    error: cancellation.reason,
  };
}

function decorateCancellation(
  result: CapabilityResult,
  support: 'cooperative' | 'not_supported',
  signal: AbortSignal,
): CapabilityResult {
  if (!signal.aborted) return result;
  const reported = cancellationRecordFrom(result.structured.cancellation);
  const cancellation = reported?.state === 'CANCELLED' && reported.observedByHandler
    ? reported
    : cancellationRecord(
        support,
        result.status === 'ok' ? 'COMPLETED_BEFORE_CANCEL' : 'FAILED_TO_CANCEL',
        signal,
        result.status === 'ok'
          ? 'The handler completed after cancellation was requested.'
          : 'Cancellation was requested, but the handler did not acknowledge a safe stop.',
        false,
      );
  return { ...result, structured: { ...result.structured, cancellation } };
}

function cancellationRecord(
  support: 'cooperative' | 'not_supported',
  state: CapabilityCancellationRecord['state'],
  signal: AbortSignal,
  detail: string,
  observedByHandler: boolean,
): CapabilityCancellationRecord {
  const reason = readAbortReason(signal) ?? createAbortReason('OWNER_CANCEL');
  return {
    support,
    state,
    reason: reason.reason,
    requestedAt: reason.requestedAt,
    ...(state === 'CANCELLED' || state === 'COMPLETED_BEFORE_CANCEL' || state === 'FAILED_TO_CANCEL'
      ? { completedAt: new Date().toISOString() }
      : {}),
    observedByHandler,
    detail,
  };
}

function cancellationRecordFrom(value: unknown): CapabilityCancellationRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Partial<CapabilityCancellationRecord>;
  if (record.state !== 'CANCELLED' || typeof record.observedByHandler !== 'boolean' || typeof record.detail !== 'string') return undefined;
  return record as CapabilityCancellationRecord;
}

function isTimeoutError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === TIMEOUT_CODE);
}

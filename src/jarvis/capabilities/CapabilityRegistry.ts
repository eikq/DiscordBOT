import type { ToolResultRef } from '../core/types';
import type {
  CapabilityAvailabilityState,
  CapabilityDescriptor,
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvokeRequest,
  CapabilityResult,
} from './types';

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
    try {
      const payload = request.confirmation
        ? { ...request.input, confirmation: request.confirmation }
        : request.input;
      return await withTimeout(handler.invoke(payload), timeoutMs, request.id);
    } catch (error) {
      if (isTimeoutError(error)) {
        return timeoutResult(request.id, timeoutMs, descriptor.sideEffect, descriptor.untrustedOutput);
      }
      const message = error instanceof Error ? error.message : String(error);
      return {
        capabilityId: request.id,
        status: 'error',
        structured: { status: 'error', error: message },
        content: '',
        sourceUrls: [],
        untrustedOutput: descriptor.untrustedOutput,
        sideEffect: descriptor.sideEffect,
        error: message,
      };
    }
  }
}

export function capabilityResultToToolRef(result: CapabilityResult): ToolResultRef {
  const status: ToolResultRef['status'] = result.status === 'ok'
    ? 'ok'
    : result.status === 'error' || result.status === 'rejected'
      ? 'error'
      : 'unavailable';
  const summary = result.status === 'ok'
    ? (result.untrustedOutput ? 'untrusted external data' : 'ok')
    : result.status === 'confirmation_required'
      ? 'permission required'
      : result.status === 'rejected'
        ? (result.error || 'denied')
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
): CapabilityResult {
  const error = `Capability ${id} timed out after ${timeoutMs}ms.`;
  return {
    capabilityId: id,
    status: 'timeout',
    structured: { status: 'timeout', error },
    content: '',
    sourceUrls: [],
    untrustedOutput,
    sideEffect,
    error,
  };
}

function withTimeout(promise: Promise<CapabilityResult>, timeoutMs: number, id: string): Promise<CapabilityResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
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

function isTimeoutError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === TIMEOUT_CODE);
}

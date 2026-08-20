import { timingSafeEqual } from 'node:crypto';

/**
 * Local-only native helper protocol. Not a network API.
 * Cloud scaffolds the contract only. Do not install a helper from this module.
 */
export const NATIVE_HELPER_PROTOCOL_VERSION = 1;

export const NATIVE_HELPER_TRANSPORT = 'loopback-ipc' as const;

export const NATIVE_WINDOW_ROLES = ['CONTROL', 'PRESENTER'] as const;
export type NativeWindowRole = (typeof NATIVE_WINDOW_ROLES)[number];

export const NATIVE_HELPER_COMMANDS = [
  'HELLO',
  'HEALTH',
  'LIST_OWNED',
  'GET_STATE',
  'MOVE',
  'RESIZE',
  'FOCUS',
  'LAYOUT',
  'FULLSCREEN',
  'RESTORE',
] as const;
export type NativeHelperCommand = (typeof NATIVE_HELPER_COMMANDS)[number];

export const FORBIDDEN_NATIVE_ARGUMENT_KEYS = [
  'hwnd',
  'hWnd',
  'processName',
  'windowTitle',
  'pid',
  'processId',
  'shell',
  'shellCommand',
  'exec',
  'script',
] as const;

export type NativeHelperAuthContract = {
  kind: 'ephemeral-owner-token';
  /** Token is owner-bound and must never be persisted, logged, or committed. */
  storage: 'never-persist';
};

export type NativeHelperHello = {
  protocolVersion: typeof NATIVE_HELPER_PROTOCOL_VERSION;
  transport: typeof NATIVE_HELPER_TRANSPORT;
  bind: '127.0.0.1';
  runtimeId: string;
  sessionId: string;
  auth: NativeHelperAuthContract;
};

export type NativeHelperHealth = {
  status: 'unavailable' | 'starting' | 'ready' | 'degraded';
  installed: boolean;
  protocolVersion: number;
  reasonCode?: 'UNSUPPORTED_HOST' | 'HELPER_UNAVAILABLE' | 'PROTOCOL_MISMATCH';
  message: string;
  ownedWindowCount?: number;
};

export type NativeHelperRequest = {
  protocolVersion: number;
  command: NativeHelperCommand;
  windowId?: string;
  role?: NativeWindowRole;
  displayId?: string;
  bounds?: { x: number; y: number; width: number; height: number };
  layout?: 'maximized' | 'minimized' | 'normal' | 'presenter' | 'restore';
  fullscreen?: boolean;
};

export type NativeHelperResponse = {
  protocolVersion: number;
  ok: boolean;
  reasonCode?: string;
  message: string;
};

const AUTH_OPTIONAL_COMMANDS = new Set<NativeHelperCommand>(['HELLO', 'HEALTH']);

export type NativeHelperAuthFields = {
  token?: string;
  nonce?: string;
  runtimeId?: string;
  sessionId?: string;
};

export function parseNativeHelperRequest(body: unknown): { ok: true; value: NativeHelperRequest } | { ok: false; reasonCode: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT' };
  }
  const raw = body as Record<string, unknown>;
  if (containsForbiddenNativeKey(raw)) {
    return { ok: false, reasonCode: 'FORBIDDEN_ARGUMENT' };
  }
  if (raw.protocolVersion !== NATIVE_HELPER_PROTOCOL_VERSION) {
    return { ok: false, reasonCode: 'PROTOCOL_MISMATCH' };
  }
  if (typeof raw.command !== 'string' || !(NATIVE_HELPER_COMMANDS as readonly string[]).includes(raw.command)) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT' };
  }
  if (raw.command === 'HELLO' || raw.command === 'HEALTH') {
    return {
      ok: true,
      value: {
        protocolVersion: NATIVE_HELPER_PROTOCOL_VERSION,
        command: raw.command,
      },
    };
  }
  if (raw.command === 'LIST_OWNED') {
    return {
      ok: true,
      value: {
        protocolVersion: NATIVE_HELPER_PROTOCOL_VERSION,
        command: raw.command,
      },
    };
  }
  if (typeof raw.windowId !== 'string' || !raw.windowId.trim()) {
    return { ok: false, reasonCode: 'INVALID_TARGET' };
  }
  return {
    ok: true,
    value: {
      protocolVersion: NATIVE_HELPER_PROTOCOL_VERSION,
      command: raw.command as NativeHelperCommand,
      windowId: raw.windowId,
      ...(raw.role === 'CONTROL' || raw.role === 'PRESENTER' ? { role: raw.role } : {}),
      ...(typeof raw.displayId === 'string' ? { displayId: raw.displayId } : {}),
      ...(isBounds(raw.bounds) ? { bounds: raw.bounds } : {}),
      ...(typeof raw.layout === 'string' ? { layout: raw.layout as NativeHelperRequest['layout'] } : {}),
      ...(typeof raw.fullscreen === 'boolean' ? { fullscreen: raw.fullscreen } : {}),
    },
  };
}

export function extractNativeHelperAuth(body: unknown): NativeHelperAuthFields {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const raw = body as Record<string, unknown>;
  const token = typeof raw.token === 'string'
    ? raw.token
    : typeof raw.authToken === 'string'
      ? raw.authToken
      : undefined;
  return {
    ...(token ? { token } : {}),
    ...(typeof raw.nonce === 'string' ? { nonce: raw.nonce } : {}),
    ...(typeof raw.runtimeId === 'string' ? { runtimeId: raw.runtimeId } : {}),
    ...(typeof raw.sessionId === 'string' ? { sessionId: raw.sessionId } : {}),
  };
}

export class NativeHelperReplayGuard {
  private readonly used = new Set<string>();

  public consume(nonce: string, max = 2_048): { ok: true } | { ok: false; reasonCode: string } {
    const value = nonce.trim();
    if (!value || value.length > 128) return { ok: false, reasonCode: 'INVALID_ARGUMENT' };
    if (this.used.has(value)) return { ok: false, reasonCode: 'REPLAY_DETECTED' };
    this.used.add(value);
    if (this.used.size > max) {
      const first = this.used.values().next().value;
      if (typeof first === 'string') this.used.delete(first);
    }
    return { ok: true };
  }
}

export function authorizeNativeHelperCommand(input: {
  command: NativeHelperCommand;
  auth: NativeHelperAuthFields;
  expectedRuntimeId: string;
  expectedSessionId: string;
  expectedToken: string;
  replay: NativeHelperReplayGuard;
}): { ok: true } | { ok: false; reasonCode: string } {
  if (AUTH_OPTIONAL_COMMANDS.has(input.command)) return { ok: true };
  if (!input.expectedToken) return { ok: false, reasonCode: 'HELPER_UNAVAILABLE' };
  if (!input.auth.token || !nativeTokensEqual(input.auth.token, input.expectedToken)) {
    return { ok: false, reasonCode: 'FORGED_IPC' };
  }
  if (input.auth.runtimeId !== input.expectedRuntimeId || input.auth.sessionId !== input.expectedSessionId) {
    return { ok: false, reasonCode: 'HELPER_IMPERSONATION' };
  }
  if (!input.auth.nonce) return { ok: false, reasonCode: 'AUTH_REQUIRED' };
  return input.replay.consume(input.auth.nonce);
}

export function nativeHelperLogSafe(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|cookie|password|confirm|nonce/iu.test(key)) continue;
    out[key] = item;
  }
  return out;
}

function containsForbiddenNativeKey(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 4) return false;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if ((FORBIDDEN_NATIVE_ARGUMENT_KEYS as readonly string[]).includes(key)) return true;
    if (containsForbiddenNativeKey(nested, depth + 1)) return true;
  }
  return false;
}

function nativeTokensEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isBounds(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(key => typeof rec[key] === 'number' && Number.isFinite(rec[key]));
}

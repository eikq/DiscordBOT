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

export function parseNativeHelperRequest(body: unknown): { ok: true; value: NativeHelperRequest } | { ok: false; reasonCode: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT' };
  }
  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if ((FORBIDDEN_NATIVE_ARGUMENT_KEYS as readonly string[]).includes(key)) {
      return { ok: false, reasonCode: 'FORBIDDEN_ARGUMENT' };
    }
  }
  if (raw.protocolVersion !== NATIVE_HELPER_PROTOCOL_VERSION) {
    return { ok: false, reasonCode: 'PROTOCOL_MISMATCH' };
  }
  if (typeof raw.command !== 'string' || !(NATIVE_HELPER_COMMANDS as readonly string[]).includes(raw.command)) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT' };
  }
  if (raw.command === 'HELLO' || raw.command === 'HEALTH' || raw.command === 'LIST_OWNED') {
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

export function nativeHelperLogSafe(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/token|secret|cookie|password|confirm/iu.test(key)) continue;
    out[key] = item;
  }
  return out;
}

function isBounds(value: unknown): value is { x: number; y: number; width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every(key => typeof rec[key] === 'number' && Number.isFinite(rec[key]));
}

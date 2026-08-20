import { randomBytes } from 'node:crypto';
import { NativeOwnershipRegistry, type OwnedJarvisWindow } from './nativeOwnership';
import {
  NATIVE_HELPER_PROTOCOL_VERSION,
  NativeHelperReplayGuard,
  authorizeNativeHelperCommand,
  extractNativeHelperAuth,
  parseNativeHelperRequest,
  type NativeHelperHealth,
  type NativeHelperRequest,
  type NativeWindowRole,
} from './nativeProtocol';
import type { DisplayBounds, DisplayInfo, JarvisWindowInfo, NativeJarvisWindowAdapter, WindowOpResult } from './types';

export type FakeNativeHelperOptions = {
  runtimeId?: string;
  sessionId?: string;
  available?: boolean;
  displays?: DisplayInfo[];
  /** Test-only ephemeral token. Never logged or persisted. */
  authToken?: string;
};

/**
 * Cloud/test fake. Does not start a Windows process and never claims a live helper.
 */
export class FakeNativeJarvisHelper {
  public readonly ownership: NativeOwnershipRegistry;
  public readonly authToken: string;
  private readonly replay = new NativeHelperReplayGuard();
  private windows = new Map<string, { role: NativeWindowRole; bounds: DisplayBounds; displayId?: string }>();

  constructor(private readonly options: FakeNativeHelperOptions = {}) {
    this.ownership = new NativeOwnershipRegistry(
      options.runtimeId || 'jarvis-runtime',
      options.sessionId || 'jarvis-lab',
    );
    this.authToken = options.authToken
      || (options.available ? randomBytes(16).toString('hex') : '');
  }

  public health(): NativeHelperHealth {
    if (!this.options.available) {
      return {
        status: 'unavailable',
        installed: false,
        protocolVersion: NATIVE_HELPER_PROTOCOL_VERSION,
        reasonCode: 'UNSUPPORTED_HOST',
        message: 'Native Jarvis helper is not installed on this host.',
        ownedWindowCount: 0,
      };
    }
    return {
      status: 'ready',
      installed: false,
      protocolVersion: NATIVE_HELPER_PROTOCOL_VERSION,
      message: 'Fake native helper is ready for tests only.',
      ownedWindowCount: this.ownership.list().length,
    };
  }

  public registerOwned(windowId: string, role: NativeWindowRole, bounds: DisplayBounds, displayId?: string): OwnedJarvisWindow {
    const owned = this.ownership.register(windowId, role);
    this.windows.set(windowId, { role, bounds: { ...bounds }, displayId });
    return owned;
  }

  public handle(body: unknown): { ok: boolean; reasonCode?: string; message: string; owned?: OwnedJarvisWindow[] } {
    const parsed = parseNativeHelperRequest(body);
    if (parsed.ok === false) {
      return { ok: false, reasonCode: parsed.reasonCode, message: 'Native helper rejected the request.' };
    }
    if (!this.options.available) {
      return { ok: false, reasonCode: 'UNSUPPORTED_HOST', message: 'Native Jarvis helper is unavailable. Fail-closed.' };
    }
    const authorized = authorizeNativeHelperCommand({
      command: parsed.value.command,
      auth: extractNativeHelperAuth(body),
      expectedRuntimeId: this.ownership.runtimeId,
      expectedSessionId: this.ownership.sessionId,
      expectedToken: this.authToken,
      replay: this.replay,
    });
    if (authorized.ok === false) {
      return { ok: false, reasonCode: authorized.reasonCode, message: 'Native helper rejected the request.' };
    }
    return this.dispatch(parsed.value);
  }

  public adapter(): NativeJarvisWindowAdapter {
    return {
      listDisplays: async () => this.options.displays ?? [],
      getOwnedWindows: async () => this.ownership.list(),
      getWindow: async () => this.windowState(this.ownership.byRole('PRESENTER')?.windowId || this.ownership.list()[0]?.windowId),
      getWindowState: async windowId => this.windowState(windowId),
      setBounds: async bounds => this.move(this.defaultWindowId(), bounds),
      moveOwnedWindow: async input => this.move(input.windowId, input.bounds, input.display),
      resizeOwnedWindow: async input => this.move(input.windowId, input.bounds),
      focus: async () => this.focus(this.defaultWindowId()),
      focusOwnedWindow: async windowId => this.focus(windowId),
      setLayout: async (layout, display) => this.layout(this.defaultWindowId(), layout, display),
      setOwnedWindowLayout: async (windowId, layout, display) => this.layout(windowId, layout, display),
      setFullscreen: async (windowId, enabled) => this.layout(windowId, enabled ? 'maximized' : 'normal'),
      restore: async windowId => this.layout(windowId, 'normal'),
    };
  }

  private dispatch(request: NativeHelperRequest): { ok: boolean; reasonCode?: string; message: string; owned?: OwnedJarvisWindow[] } {
    if (request.command === 'HEALTH' || request.command === 'HELLO') {
      return { ok: true, message: this.health().message };
    }
    if (request.command === 'LIST_OWNED') {
      return { ok: true, message: `${this.ownership.list().length} owned Jarvis windows.`, owned: this.ownership.list() };
    }
    const required = this.ownership.requireOwned(request.windowId || '');
    if ('ok' in required && required.ok === false) {
      return { ok: false, reasonCode: 'INVALID_TARGET', message: 'That window is not a registered Jarvis-owned window.' };
    }
    return { ok: true, message: `${request.command} accepted for owned window.` };
  }

  private defaultWindowId(): string {
    return this.ownership.byRole('PRESENTER')?.windowId || this.ownership.list()[0]?.windowId || '';
  }

  private windowState(windowId?: string): JarvisWindowInfo {
    if (!windowId) {
      return {
        available: false,
        hostKind: 'test',
        state: 'unknown',
        reasonCode: 'WINDOW_UNAVAILABLE',
        source: 'none',
      };
    }
    const required = this.ownership.requireOwned(windowId);
    if ('ok' in required && required.ok === false) {
      return {
        available: false,
        hostKind: 'test',
        state: 'unknown',
        reasonCode: 'INVALID_TARGET',
        source: 'none',
      };
    }
    const stored = this.windows.get(windowId);
    return {
      available: true,
      hostKind: 'test',
      bounds: stored?.bounds,
      displayId: stored?.displayId,
      state: 'normal',
      source: 'native',
    };
  }

  private move(windowId: string, bounds: DisplayBounds, display?: DisplayInfo): WindowOpResult {
    const required = this.ownership.requireOwned(windowId);
    if ('ok' in required && required.ok === false) {
      return {
        status: 'failed',
        reasonCode: 'INVALID_TARGET',
        message: 'Jarvis will only move a registered Jarvis-owned window.',
        hostKind: 'test',
      };
    }
    const stored = this.windows.get(windowId) || { role: 'PRESENTER' as const, bounds, displayId: display?.id };
    stored.bounds = { ...bounds };
    if (display) stored.displayId = display.id;
    this.windows.set(windowId, stored);
    return {
      status: 'moved',
      message: 'Moved owned Jarvis window.',
      hostKind: 'test',
      display,
      window: this.windowState(windowId),
    };
  }

  private focus(windowId: string): WindowOpResult {
    const required = this.ownership.requireOwned(windowId);
    if ('ok' in required && required.ok === false) {
      return {
        status: 'failed',
        reasonCode: 'INVALID_TARGET',
        message: 'Jarvis will only focus a registered Jarvis-owned window.',
        hostKind: 'test',
      };
    }
    return {
      status: 'focused',
      message: 'Focused owned Jarvis window.',
      hostKind: 'test',
      window: this.windowState(windowId),
    };
  }

  private layout(windowId: string, layout: string, display?: DisplayInfo): WindowOpResult {
    const required = this.ownership.requireOwned(windowId);
    if ('ok' in required && required.ok === false) {
      return {
        status: 'failed',
        reasonCode: 'INVALID_TARGET',
        message: 'Jarvis will only change layout of a registered Jarvis-owned window.',
        hostKind: 'test',
      };
    }
    if (display && (layout === 'maximized' || layout === 'presenter')) {
      return this.move(windowId, display.workingArea, display);
    }
    return {
      status: 'layout-set',
      message: `Owned Jarvis layout ${layout}.`,
      hostKind: 'test',
      display,
      window: this.windowState(windowId),
    };
  }
}

export function unavailableNativeHelperHealth(): NativeHelperHealth {
  return {
    status: 'unavailable',
    installed: false,
    protocolVersion: NATIVE_HELPER_PROTOCOL_VERSION,
    reasonCode: 'UNSUPPORTED_HOST',
    message: 'Native Jarvis helper is not installed. Browser host remains read-only for window mutation.',
  };
}

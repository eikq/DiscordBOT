import type { NativeWindowRole } from './nativeProtocol';

export type OwnedJarvisWindow = {
  windowId: string;
  role: NativeWindowRole;
  sessionId: string;
  runtimeId: string;
};

/**
 * Registry of Jarvis-owned windows for one runtime/session.
 * CONTROL and PRESENTER are roles of the same runtime — not a second Jarvis.
 */
export class NativeOwnershipRegistry {
  private readonly windows = new Map<string, OwnedJarvisWindow>();

  constructor(public readonly runtimeId: string, public readonly sessionId: string) {}

  public register(windowId: string, role: NativeWindowRole): OwnedJarvisWindow {
    const existing = [...this.windows.values()].find(item => item.role === role);
    if (existing && existing.windowId !== windowId) {
      this.windows.delete(existing.windowId);
    }
    const owned: OwnedJarvisWindow = {
      windowId,
      role,
      sessionId: this.sessionId,
      runtimeId: this.runtimeId,
    };
    this.windows.set(windowId, owned);
    return { ...owned };
  }

  public get(windowId: string): OwnedJarvisWindow | undefined {
    const found = this.windows.get(windowId);
    return found ? { ...found } : undefined;
  }

  public requireOwned(windowId: string): OwnedJarvisWindow | { ok: false; reasonCode: 'INVALID_TARGET' } {
    const found = this.get(windowId);
    if (!found) return { ok: false, reasonCode: 'INVALID_TARGET' };
    return found;
  }

  public byRole(role: NativeWindowRole): OwnedJarvisWindow | undefined {
    return [...this.windows.values()].find(item => item.role === role);
  }

  public list(): OwnedJarvisWindow[] {
    return [...this.windows.values()].map(item => ({ ...item }));
  }

  public sameRuntime(runtimeId: string, sessionId: string): boolean {
    return this.runtimeId === runtimeId && this.sessionId === sessionId;
  }
}

export function rejectForeignWindowTarget(input: Record<string, unknown>): string | undefined {
  if ('hwnd' in input || 'hWnd' in input) return 'INVALID_TARGET';
  if ('processName' in input || 'windowTitle' in input) return 'INVALID_TARGET';
  if ('pid' in input || 'processId' in input) return 'INVALID_TARGET';
  return undefined;
}

import { displayContaining } from './displayNames';
import type {
  ClientWindowReport,
  DesktopHostKind,
  DisplayBounds,
  DisplayInfo,
  JarvisWindowInfo,
} from './types';

export class JarvisPresenceStore {
  private report: ClientWindowReport | null = null;
  private previousBounds: DisplayBounds | null = null;

  public reportClientWindow(report: ClientWindowReport): ClientWindowReport {
    this.report = {
      ...report,
      reportedAt: report.reportedAt || new Date().toISOString(),
    };
    return this.report;
  }

  public currentReport(): ClientWindowReport | null {
    return this.report;
  }

  public rememberBounds(bounds: DisplayBounds): void {
    this.previousBounds = { ...bounds };
  }

  public restoreBounds(): DisplayBounds | null {
    return this.previousBounds ? { ...this.previousBounds } : null;
  }

  public windowFromReport(
    displays: DisplayInfo[],
    hostKind: DesktopHostKind,
  ): JarvisWindowInfo {
    if (!this.report) {
      return {
        available: false,
        hostKind,
        state: 'unknown',
        reasonCode: 'WINDOW_UNAVAILABLE',
        source: 'none',
      };
    }
    const bounds: DisplayBounds = {
      x: this.report.screenX,
      y: this.report.screenY,
      width: this.report.outerWidth,
      height: this.report.outerHeight,
    };
    const display = displayContaining(displays, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    return {
      available: true,
      hostKind,
      bounds,
      displayId: display?.id,
      displayName: display?.name,
      state: this.report.isMaximized ? 'maximized' : 'normal',
      source: 'client-report',
    };
  }
}

let shared: JarvisPresenceStore | undefined;

export function sharedJarvisPresenceStore(): JarvisPresenceStore {
  shared ??= new JarvisPresenceStore();
  return shared;
}

export function resetSharedJarvisPresenceStore(): void {
  shared = new JarvisPresenceStore();
}

export function parseClientWindowReport(body: unknown): { ok: true; value: ClientWindowReport } | { ok: false; reasonCode: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT' };
  }
  const raw = body as Record<string, unknown>;
  const allowed = ['screenX', 'screenY', 'outerWidth', 'outerHeight', 'availWidth', 'availHeight', 'screenWidth', 'screenHeight', 'isMaximized'];
  if (Object.keys(raw).some(key => !allowed.includes(key))) {
    return { ok: false, reasonCode: 'FORBIDDEN_ARGUMENT' };
  }
  const screenX = raw.screenX;
  const screenY = raw.screenY;
  const outerWidth = raw.outerWidth;
  const outerHeight = raw.outerHeight;
  if ([screenX, screenY, outerWidth, outerHeight].some(value => typeof value !== 'number' || !Number.isFinite(value))) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT' };
  }
  if ((outerWidth as number) < 200 || (outerHeight as number) < 200 || (outerWidth as number) > 16000 || (outerHeight as number) > 16000) {
    return { ok: false, reasonCode: 'INVALID_BOUNDS' };
  }
  return {
    ok: true,
    value: {
      screenX: screenX as number,
      screenY: screenY as number,
      outerWidth: outerWidth as number,
      outerHeight: outerHeight as number,
      ...(typeof raw.availWidth === 'number' ? { availWidth: raw.availWidth } : {}),
      ...(typeof raw.availHeight === 'number' ? { availHeight: raw.availHeight } : {}),
      ...(typeof raw.screenWidth === 'number' ? { screenWidth: raw.screenWidth } : {}),
      ...(typeof raw.screenHeight === 'number' ? { screenHeight: raw.screenHeight } : {}),
      ...(typeof raw.isMaximized === 'boolean' ? { isMaximized: raw.isMaximized } : {}),
    },
  };
}

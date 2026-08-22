/**
 * Read-only structured desktop perception.
 * Handler success is not verification. Observation is.
 */

import { fingerprintDisplay, serializeDisplayFingerprint, type DisplayFingerprint } from './displayIdentity';
import type { DisplayInfo } from './monitorTopology';
import { overlapRatio } from './windowPlacement';

export const PLACEMENT_OVERLAP_VERIFIED = 0.55;
export const PLACEMENT_CENTER_OVERLAP_MIN = 0.35;

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowSnapshot = {
  windowHandle: string;
  processId?: number;
  processName?: string;
  title?: string;
  bounds: WindowBounds;
  visible?: boolean;
  minimized?: boolean;
  maximized?: boolean;
  displayFingerprint?: string;
  overlapRatio?: number;
  observedAt: number;
  foreground?: boolean;
};

export type DesktopPerceptionSnapshot = {
  observedAt: number;
  displays: DisplayInfo[];
  windows: WindowSnapshot[];
  foreground?: WindowSnapshot;
  cachedHost: boolean;
  readOnly: true;
};

export type WindowDiff = {
  appeared: WindowSnapshot[];
  disappeared: WindowSnapshot[];
  moved: Array<{ before: WindowSnapshot; after: WindowSnapshot }>;
};

export type PlacementVerification = {
  verified: boolean;
  overlapRatio: number;
  centerInside: boolean;
  displayId?: string;
  displayFingerprint?: string;
};

export interface DesktopPerceptionProvider {
  snapshot(): Promise<DesktopPerceptionSnapshot>;
  getWindow(handle: string): Promise<WindowSnapshot | null>;
}

export function parseWindowSnapshot(
  raw: unknown,
  observedAt = Date.now(),
): WindowSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Record<string, unknown>;
  const handle = String(item.Handle ?? item.windowHandle ?? item.handle ?? '');
  const width = Number(item.Width ?? item.width ?? (item.bounds as WindowBounds | undefined)?.width);
  const height = Number(item.Height ?? item.height ?? (item.bounds as WindowBounds | undefined)?.height);
  const x = Number(item.X ?? item.x ?? (item.bounds as WindowBounds | undefined)?.x);
  const y = Number(item.Y ?? item.y ?? (item.bounds as WindowBounds | undefined)?.y);
  if (!/^[0-9]+$/u.test(handle) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const processId = Number(item.ProcessId ?? item.processId);
  const title = typeof item.Title === 'string' ? item.Title : typeof item.title === 'string' ? item.title : undefined;
  const processName = typeof item.ProcessName === 'string' && item.ProcessName
    ? String(item.ProcessName)
    : typeof item.processName === 'string' ? item.processName : undefined;
  return {
    windowHandle: handle,
    bounds: {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0,
      width,
      height,
    },
    observedAt,
    ...(Number.isInteger(processId) && processId > 0 ? { processId } : {}),
    ...(processName ? { processName } : {}),
    ...(title ? { title } : {}),
    ...(typeof item.Visible === 'boolean' || typeof item.visible === 'boolean'
      ? { visible: Boolean(item.Visible ?? item.visible) }
      : {}),
    ...(typeof item.Minimized === 'boolean' || typeof item.minimized === 'boolean'
      ? { minimized: Boolean(item.Minimized ?? item.minimized) }
      : {}),
    ...(typeof item.Maximized === 'boolean' || typeof item.maximized === 'boolean'
      ? { maximized: Boolean(item.Maximized ?? item.maximized) }
      : {}),
    ...(typeof item.Foreground === 'boolean' || typeof item.foreground === 'boolean'
      ? { foreground: Boolean(item.Foreground ?? item.foreground) }
      : {}),
  };
}

export function parseWindowSnapshotList(raw: string, observedAt = Date.now()): WindowSnapshot[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap(item => {
      const snapshot = parseWindowSnapshot(item, observedAt);
      return snapshot ? [snapshot] : [];
    });
  } catch {
    return [];
  }
}

export function enrichWindows(
  windows: WindowSnapshot[],
  displays: DisplayInfo[],
): WindowSnapshot[] {
  return windows.map(window => {
    const ranked = displays
      .map(display => ({ display, ratio: overlapRatio(window.bounds, display) }))
      .sort((left, right) => right.ratio - left.ratio);
    const best = ranked[0];
    if (!best || best.ratio <= 0) return window;
    return {
      ...window,
      overlapRatio: best.ratio,
      displayFingerprint: serializeDisplayFingerprint(fingerprintDisplay(best.display)),
    };
  });
}

export function buildPerceptionSnapshot(input: {
  displays: DisplayInfo[];
  windows: WindowSnapshot[];
  cachedHost: boolean;
  observedAt?: number;
}): DesktopPerceptionSnapshot {
  const observedAt = input.observedAt ?? Date.now();
  const windows = enrichWindows(input.windows, input.displays);
  return {
    observedAt,
    displays: input.displays,
    windows,
    foreground: windows.find(item => item.foreground),
    cachedHost: input.cachedHost,
    readOnly: true,
  };
}

export function diffWindows(pre: WindowSnapshot[], post: WindowSnapshot[]): WindowDiff {
  const before = new Map(pre.map(item => [item.windowHandle, item]));
  const after = new Map(post.map(item => [item.windowHandle, item]));
  const appeared = post.filter(item => !before.has(item.windowHandle));
  const disappeared = pre.filter(item => !after.has(item.windowHandle));
  const moved = post.flatMap(item => {
    const prior = before.get(item.windowHandle);
    if (!prior) return [];
    if (
      prior.bounds.x === item.bounds.x
      && prior.bounds.y === item.bounds.y
      && prior.bounds.width === item.bounds.width
      && prior.bounds.height === item.bounds.height
    ) {
      return [];
    }
    return [{ before: prior, after: item }];
  });
  return { appeared, disappeared, moved };
}

export function windowCenterInside(
  bounds: WindowBounds,
  display: Pick<DisplayInfo, 'x' | 'y' | 'width' | 'height'>,
): boolean {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  return cx >= display.x && cx < display.x + display.width && cy >= display.y && cy < display.y + display.height;
}

export function verifyPlacement(
  window: Pick<WindowSnapshot, 'bounds'> | null | undefined,
  display: Pick<DisplayInfo, 'id' | 'x' | 'y' | 'width' | 'height'> | undefined,
): PlacementVerification {
  if (!window || !display) {
    return { verified: false, overlapRatio: 0, centerInside: false };
  }
  const ratio = overlapRatio(window.bounds, display);
  const centerInside = windowCenterInside(window.bounds, display);
  const verified = ratio >= PLACEMENT_OVERLAP_VERIFIED
    || (centerInside && ratio >= PLACEMENT_CENTER_OVERLAP_MIN);
  return {
    verified,
    overlapRatio: ratio,
    centerInside,
    displayId: display.id,
    displayFingerprint: 'id' in display
      ? serializeDisplayFingerprint(fingerprintDisplay(display as DisplayInfo))
      : undefined,
  };
}

export function titleHintsForResource(input: { url?: string; label?: string; applicationId?: string }): string[] {
  const hints: string[] = [];
  if (input.label) hints.push(input.label.toLocaleLowerCase());
  if (input.applicationId) hints.push(input.applicationId.toLocaleLowerCase());
  if (input.url) {
    try {
      const host = new URL(input.url).hostname.replace(/^www\./iu, '').toLocaleLowerCase();
      hints.push(host);
      for (const part of host.split('.')) {
        if (part.length >= 4) hints.push(part);
      }
    } catch {
      /* ignore invalid URL */
    }
  }
  return [...new Set(hints.filter(item => item.length >= 4))];
}

export function windowMatchesHints(window: WindowSnapshot, hints: string[]): boolean {
  const hay = `${window.title || ''} ${window.processName || ''}`.toLocaleLowerCase();
  return hints.some(hint => hay.includes(hint));
}

export function nextVerifiedDisplays(
  current: { current?: string; previous?: string },
  incomingFingerprint: string | undefined,
  verified: boolean,
): { current?: string; previous?: string } {
  if (!verified || !incomingFingerprint) {
    return { current: current.current, previous: current.previous };
  }
  if (current.current && current.current === incomingFingerprint) {
    return { current: incomingFingerprint, previous: current.previous };
  }
  return {
    current: incomingFingerprint,
    previous: current.current,
  };
}

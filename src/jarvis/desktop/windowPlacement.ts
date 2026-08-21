/**
 * Read-only window-to-display overlap. Used for verify and containment reconcile.
 */

import type { DisplayInfo } from './monitorTopology';

export type WindowRect = {
  handle: string;
  processName: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowDisplayPlacement = {
  windowFound: boolean;
  handle?: string;
  displayId?: string;
  overlapRatio?: number;
  straddling: boolean;
  fullyOnOneDisplay: boolean;
};

export function overlapRatio(
  window: Pick<WindowRect, 'x' | 'y' | 'width' | 'height'>,
  display: Pick<DisplayInfo, 'x' | 'y' | 'width' | 'height'>,
): number {
  const area = window.width * window.height;
  if (area <= 0) return 0;
  const left = Math.max(window.x, display.x);
  const top = Math.max(window.y, display.y);
  const right = Math.min(window.x + window.width, display.x + display.width);
  const bottom = Math.min(window.y + window.height, display.y + display.height);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  return overlap / area;
}

export function classifyWindowOnDisplays(
  window: WindowRect | null | undefined,
  displays: DisplayInfo[],
): WindowDisplayPlacement {
  if (!window || window.width <= 0 || window.height <= 0) {
    return { windowFound: false, straddling: false, fullyOnOneDisplay: false };
  }
  const ranked = displays
    .map(display => ({ display, ratio: overlapRatio(window, display) }))
    .filter(item => item.ratio > 0)
    .sort((left, right) => right.ratio - left.ratio);
  const best = ranked[0];
  const straddling = ranked.filter(item => item.ratio >= 0.15).length > 1;
  const fullyOnOneDisplay = Boolean(best && best.ratio >= 0.6 && !straddling);
  return {
    windowFound: true,
    handle: window.handle,
    displayId: best?.display.id,
    overlapRatio: best?.ratio,
    straddling,
    fullyOnOneDisplay,
  };
}

export function parseWindowRectJson(raw: string, processName: string): WindowRect | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const handle = String(parsed.Handle ?? parsed.handle ?? '');
    const width = Number(parsed.Width ?? parsed.width);
    const height = Number(parsed.Height ?? parsed.height);
    if (!/^[0-9]+$/u.test(handle) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }
    return {
      handle,
      processName: typeof parsed.ProcessName === 'string' && parsed.ProcessName ? String(parsed.ProcessName) : processName,
      x: Number(parsed.X ?? parsed.x) || 0,
      y: Number(parsed.Y ?? parsed.y) || 0,
      width,
      height,
    };
  } catch {
    return null;
  }
}

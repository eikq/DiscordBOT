import type { DisplayBounds, DisplayInfo } from './types';

export function intersectionArea(a: DisplayBounds, b: DisplayBounds): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

export function pointInDisplay(display: DisplayInfo, point: { x: number; y: number }): boolean {
  return point.x >= display.bounds.x
    && point.y >= display.bounds.y
    && point.x < display.bounds.x + display.bounds.width
    && point.y < display.bounds.y + display.bounds.height;
}

/**
 * Select the display with the greatest positive intersection area.
 * Do not fall back to primary when the rectangle sits in a gap or on an exclusive edge.
 */
export function displayIntersectingBounds(
  displays: DisplayInfo[],
  bounds: DisplayBounds,
): DisplayInfo | undefined {
  let best: DisplayInfo | undefined;
  let bestArea = 0;
  for (const display of displays) {
    const area = intersectionArea(bounds, display.bounds);
    if (area > bestArea) {
      best = display;
      bestArea = area;
    }
  }
  return bestArea > 0 ? best : undefined;
}

/**
 * Adaptive rendering quality for the WebGL Jarvis Core.
 * Pure data + decision logic (unit-tested); the scene consumes presets.
 */

export type QualityLevel = 'high' | 'balanced' | 'minimal';
export type QualityMode = 'auto' | QualityLevel | '2d';

export type QualityPreset = {
  level: QualityLevel;
  dprCap: number;
  antialias: boolean;
  particleCount: number;
  cognitionPointCount: number;
  filamentCount: number;
  ringTicks: number;
  graphNodeCap: number;
  graphEdgeCap: number;
  streamPool: number;
  ringLabels: boolean;
};

const PRESETS: Record<QualityLevel, QualityPreset> = {
  high: {
    level: 'high',
    dprCap: 1.75,
    antialias: true,
    particleCount: 4200,
    cognitionPointCount: 900,
    filamentCount: 84,
    ringTicks: 96,
    graphNodeCap: 420,
    graphEdgeCap: 720,
    streamPool: 28,
    ringLabels: true,
  },
  balanced: {
    level: 'balanced',
    dprCap: 1.25,
    antialias: true,
    particleCount: 2200,
    cognitionPointCount: 480,
    filamentCount: 44,
    ringTicks: 64,
    graphNodeCap: 280,
    graphEdgeCap: 460,
    streamPool: 18,
    ringLabels: false,
  },
  minimal: {
    level: 'minimal',
    dprCap: 1,
    antialias: false,
    particleCount: 900,
    cognitionPointCount: 180,
    filamentCount: 16,
    ringTicks: 0,
    graphNodeCap: 160,
    graphEdgeCap: 240,
    streamPool: 8,
    ringLabels: false,
  },
};

export function qualityPreset(level: QualityLevel): QualityPreset {
  return PRESETS[level];
}

export function resolveQualityLevel(mode: QualityMode, autoLevel: QualityLevel): QualityLevel | '2d' {
  if (mode === '2d') return '2d';
  if (mode === 'auto') return autoLevel;
  return mode;
}

/**
 * Auto mode stepping: drop a level when FPS is poor, recover slowly.
 * Returns the next level, or null when no change is needed.
 */
export function nextAutoQuality(current: QualityLevel, averageFps: number): QualityLevel | null {
  if (!Number.isFinite(averageFps) || averageFps <= 0) return null;
  if (averageFps < 42) {
    if (current === 'high') return 'balanced';
    if (current === 'balanced') return 'minimal';
    return null;
  }
  if (averageFps > 57) {
    if (current === 'minimal') return 'balanced';
    if (current === 'balanced') return 'high';
    return null;
  }
  return null;
}

export function clampDpr(devicePixelRatio: number, preset: QualityPreset): number {
  const safe = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.max(0.75, Math.min(preset.dprCap, safe));
}

export const QUALITY_STORAGE_KEY = 'jarvis-lab-quality';

export function parseQualityMode(raw: string | null | undefined): QualityMode {
  if (raw === 'high' || raw === 'balanced' || raw === 'minimal' || raw === '2d' || raw === 'auto') return raw;
  return 'auto';
}

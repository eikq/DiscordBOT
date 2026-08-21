/**
 * Presence-only quality budget. Does not change Control Center CoreScene presets.
 */

export type PresenceQualityTier = 'HIGH' | 'BALANCED' | 'LOW';

export type PresenceParticleBudget = {
  micro: number;
  orbital: number;
  ambient: number;
  data: number;
  source: number;
};

export type PresenceQualityBudget = {
  tier: PresenceQualityTier;
  dprCap: number;
  antialias: boolean;
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
  dof: boolean;
  shaders: boolean;
  gyroRings: number;
  mechanicalSegments: number;
  tickMarks: number;
  particles: PresenceParticleBudget;
  visibleNodeCap: number;
  connectionCap: number;
  streamCap: number;
  glow: 'full' | 'simple' | 'none';
  parallax: number;
  volumetric: boolean;
  neuralNodes: number;
  lightning: boolean;
};

const BUDGETS: Record<PresenceQualityTier, PresenceQualityBudget> = {
  HIGH: {
    tier: 'HIGH',
    dprCap: 1.75,
    antialias: true,
    bloom: true,
    bloomStrength: 0.74,
    bloomThreshold: 0.72,
    bloomRadius: 0.28,
    dof: false,
    shaders: true,
    gyroRings: 4,
    mechanicalSegments: 24,
    tickMarks: 72,
    particles: { micro: 96, orbital: 140, ambient: 160, data: 40, source: 20 },
    visibleNodeCap: 8,
    connectionCap: 12,
    streamCap: 28,
    glow: 'full',
    parallax: 0.038,
    volumetric: true,
    neuralNodes: 14,
    lightning: true,
  },
  BALANCED: {
    tier: 'BALANCED',
    dprCap: 1.25,
    antialias: true,
    bloom: true,
    bloomStrength: 0.38,
    bloomThreshold: 0.88,
    bloomRadius: 0.22,
    dof: false,
    shaders: true,
    gyroRings: 3,
    mechanicalSegments: 16,
    tickMarks: 48,
    particles: { micro: 48, orbital: 72, ambient: 72, data: 20, source: 10 },
    visibleNodeCap: 8,
    connectionCap: 8,
    streamCap: 16,
    glow: 'simple',
    parallax: 0.022,
    volumetric: true,
    neuralNodes: 9,
    lightning: true,
  },
  LOW: {
    tier: 'LOW',
    dprCap: 1,
    antialias: false,
    bloom: false,
    bloomStrength: 0,
    bloomThreshold: 1,
    bloomRadius: 0,
    dof: false,
    shaders: false,
    gyroRings: 2,
    mechanicalSegments: 8,
    tickMarks: 24,
    particles: { micro: 16, orbital: 24, ambient: 24, data: 8, source: 0 },
    visibleNodeCap: 6,
    connectionCap: 4,
    streamCap: 6,
    glow: 'none',
    parallax: 0,
    volumetric: false,
    neuralNodes: 0,
    lightning: false,
  },
};

export function presenceQualityBudget(tier: PresenceQualityTier): PresenceQualityBudget {
  return BUDGETS[tier];
}

export function presenceParticleCount(tier: PresenceQualityTier): number {
  const particles = presenceQualityBudget(tier).particles;
  return particles.micro + particles.orbital + particles.ambient + particles.data + particles.source;
}

export function presenceTierFromLabLevel(level: 'high' | 'balanced' | 'minimal' | '2d'): PresenceQualityTier {
  if (level === 'minimal' || level === '2d') return 'LOW';
  if (level === 'balanced') return 'BALANCED';
  return 'HIGH';
}

export function nextPresenceAutoTier(current: PresenceQualityTier, averageFps: number): PresenceQualityTier | null {
  if (!Number.isFinite(averageFps) || averageFps <= 0) return null;
  if (averageFps < 36) {
    if (current === 'HIGH') return 'BALANCED';
    if (current === 'BALANCED') return 'LOW';
    return null;
  }
  if (averageFps > 58) {
    if (current === 'LOW') return 'BALANCED';
    if (current === 'BALANCED') return 'HIGH';
    return null;
  }
  return null;
}

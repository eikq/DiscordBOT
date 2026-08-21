/**
 * Presence-only quality budget. Does not change Control Center CoreScene presets.
 */

export type PresenceQualityTier = 'HIGH' | 'BALANCED' | 'LOW';

export type PresenceQualityBudget = {
  tier: PresenceQualityTier;
  dprCap: number;
  antialias: boolean;
  coreAccentCount: number;
  orbitPlanes: number;
  visibleNodeCap: number;
  connectionCap: number;
  glow: 'full' | 'simple' | 'none';
  parallax: number;
  volumetric: boolean;
};

const BUDGETS: Record<PresenceQualityTier, PresenceQualityBudget> = {
  HIGH: {
    tier: 'HIGH',
    dprCap: 1.75,
    antialias: true,
    coreAccentCount: 64,
    orbitPlanes: 2,
    visibleNodeCap: 8,
    connectionCap: 10,
    glow: 'full',
    parallax: 0.018,
    volumetric: true,
  },
  BALANCED: {
    tier: 'BALANCED',
    dprCap: 1.25,
    antialias: true,
    coreAccentCount: 32,
    orbitPlanes: 2,
    visibleNodeCap: 8,
    connectionCap: 8,
    glow: 'simple',
    parallax: 0.01,
    volumetric: false,
  },
  LOW: {
    tier: 'LOW',
    dprCap: 1,
    antialias: false,
    coreAccentCount: 12,
    orbitPlanes: 1,
    visibleNodeCap: 6,
    connectionCap: 4,
    glow: 'none',
    parallax: 0,
    volumetric: false,
  },
};

export function presenceQualityBudget(tier: PresenceQualityTier): PresenceQualityBudget {
  return BUDGETS[tier];
}

export function presenceTierFromLabLevel(level: 'high' | 'balanced' | 'minimal' | '2d'): PresenceQualityTier {
  if (level === 'minimal' || level === '2d') return 'LOW';
  if (level === 'balanced') return 'BALANCED';
  return 'HIGH';
}

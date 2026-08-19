import type { LabCorePhase } from '../labUiState';

/**
 * Deterministic mapping from observable lab state to Core scene parameters.
 * No hidden chain-of-thought: everything here derives from the same
 * phase/flags the 2D core already used, plus real night-agent status.
 */

export type SceneMood = {
  phase: LabCorePhase;
  nightActive: boolean;
  /** primary particle/nucleus color (hex) */
  primary: string;
  /** accent for rings/edges (hex) */
  accent: string;
  particleSpeed: number;
  /** 0 shell … 1 contracted toward the nucleus */
  contract: number;
  turbulence: number;
  nucleusIntensity: number;
  ringSpeed: number;
  /** ripple emitters */
  pulse: 'none' | 'listening' | 'speaking' | 'responding';
  /** master dimmer (degraded/error) */
  dim: number;
};

const BASE: SceneMood = {
  phase: 'idle',
  nightActive: false,
  primary: '#7dd3fc',
  accent: '#38bdf8',
  particleSpeed: 0.24,
  contract: 0.04,
  turbulence: 0.24,
  nucleusIntensity: 0.9,
  ringSpeed: 0.32,
  pulse: 'none',
  dim: 1,
};

export function sceneMoodFor(phase: LabCorePhase, options: { nightActive?: boolean } = {}): SceneMood {
  const nightActive = Boolean(options.nightActive);
  const mood: SceneMood = { ...BASE, phase, nightActive };
  switch (phase) {
    case 'listening':
      mood.primary = '#38bdf8';
      mood.accent = '#7dd3fc';
      mood.particleSpeed = 0.42;
      mood.turbulence = 0.3;
      mood.nucleusIntensity = 1.12;
      mood.pulse = 'listening';
      mood.ringSpeed = 0.62;
      break;
    case 'transcribing':
      mood.primary = '#a5b4fc';
      mood.accent = '#818cf8';
      mood.particleSpeed = 0.8;
      mood.turbulence = 0.5;
      mood.ringSpeed = 1.2;
      break;
    case 'thinking':
      mood.primary = '#c4b5fd';
      mood.accent = '#a78bfa';
      mood.particleSpeed = 1.4;
      mood.contract = 0.62;
      mood.turbulence = 0.82;
      mood.nucleusIntensity = 1.65;
      mood.ringSpeed = 1.35;
      break;
    case 'memory':
      mood.primary = '#8b5cf6';
      mood.accent = '#22d3ee';
      mood.particleSpeed = 0.64;
      mood.contract = 0.2;
      mood.nucleusIntensity = 1.24;
      mood.ringSpeed = 0.78;
      break;
    case 'tool':
      mood.primary = '#2dd4bf';
      mood.accent = '#fbbf24';
      mood.particleSpeed = 0.72;
      mood.nucleusIntensity = 1.2;
      mood.ringSpeed = 0.96;
      break;
    case 'responding':
      mood.primary = '#bae6fd';
      mood.accent = '#7dd3fc';
      mood.particleSpeed = 0.9;
      mood.contract = 0;
      mood.nucleusIntensity = 1.42;
      mood.pulse = 'responding';
      mood.ringSpeed = 1.1;
      break;
    case 'speaking':
      mood.primary = '#e0f2fe';
      mood.accent = '#7dd3fc';
      mood.particleSpeed = 0.85;
      mood.nucleusIntensity = 1.62;
      mood.pulse = 'speaking';
      mood.ringSpeed = 1;
      break;
    case 'degraded':
      mood.primary = '#94a3b8';
      mood.accent = '#f59e0b';
      mood.particleSpeed = 0.2;
      mood.turbulence = 0.2;
      mood.nucleusIntensity = 0.5;
      mood.ringSpeed = 0.25;
      mood.dim = 0.55;
      break;
    case 'error':
      mood.primary = '#f87171';
      mood.accent = '#f0abfc';
      mood.particleSpeed = 0.3;
      mood.turbulence = 0.25;
      mood.nucleusIntensity = 0.8;
      mood.ringSpeed = 0.35;
      mood.dim = 0.8;
      break;
    default:
      break;
  }
  if (nightActive && (phase === 'idle' || phase === 'degraded')) {
    mood.primary = '#a78bfa';
    mood.accent = '#8b5cf6';
    mood.nucleusIntensity = Math.max(mood.nucleusIntensity, 1.12);
    mood.ringSpeed = Math.max(mood.ringSpeed, 0.58);
  }
  return mood;
}

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const value = Number.parseInt(clean.length === 3
    ? clean.split('').map(char => char + char).join('')
    : clean, 16);
  if (!Number.isFinite(value)) return [1, 1, 1];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

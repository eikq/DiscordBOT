import type { PresencePhase } from '../presenceRuntime';

export type CoreEnergyDirection = 'in' | 'out' | 'hold';

export type PresenceCoreMotion = {
  phase: PresencePhase;
  primary: string;
  accent: string;
  breath: number;
  ringSpeed: number;
  counterSpeed: number;
  orbitSpeed: number;
  energy: CoreEnergyDirection;
  lock: boolean;
  nucleus: number;
  instability: number;
  waveform: boolean;
};

const PALETTE = {
  cyan: '#5ee7ff',
  ice: '#d7f7ff',
  teal: '#6ef0c8',
  amber: '#f0c36a',
  red: '#ff6b7a',
  mute: '#7d97a8',
};

export function presenceCoreMotion(phase: PresencePhase, reducedMotion = false): PresenceCoreMotion {
  const base: PresenceCoreMotion = {
    phase,
    primary: PALETTE.cyan,
    accent: PALETTE.ice,
    breath: 0.22,
    ringSpeed: 0.08,
    counterSpeed: -0.05,
    orbitSpeed: 0.035,
    energy: 'hold',
    lock: false,
    nucleus: 0.72,
    instability: 0,
    waveform: false,
  };

  switch (phase) {
    case 'LISTENING':
      return { ...base, breath: 0.7, waveform: true, nucleus: 1.05, ringSpeed: 0.18 };
    case 'UNDERSTANDING':
      return { ...base, ringSpeed: 0.28, counterSpeed: -0.24, energy: 'in', nucleus: 1 };
    case 'THINKING':
      return { ...base, ringSpeed: 0.22, orbitSpeed: 0.06, nucleus: 1.12 };
    case 'RESEARCHING':
      return { ...base, energy: 'in', ringSpeed: 0.16, orbitSpeed: 0.05, nucleus: 1.08 };
    case 'PLANNING':
      return { ...base, ringSpeed: 0.14, orbitSpeed: 0.045, nucleus: 1 };
    case 'EXECUTING':
      return { ...base, energy: 'out', primary: PALETTE.teal, ringSpeed: 0.2, nucleus: 1.1 };
    case 'VERIFYING':
      return { ...base, primary: PALETTE.teal, accent: PALETTE.cyan, energy: 'in', ringSpeed: 0.06, nucleus: 1.05 };
    case 'SPEAKING':
      return { ...base, waveform: true, nucleus: 1.18, breath: 0.55 };
    case 'WAITING_OWNER':
      return { ...base, primary: PALETTE.amber, accent: PALETTE.amber, breath: 0.12, ringSpeed: 0.03, orbitSpeed: 0.012, nucleus: 0.86 };
    case 'EVOLVING':
      return { ...base, ringSpeed: 0.1, orbitSpeed: 0.04, nucleus: 1 };
    case 'WARNING':
      return { ...base, primary: PALETTE.amber, instability: 0.22, ringSpeed: 0.09 };
    case 'CRITICAL':
      return { ...base, primary: PALETTE.red, instability: 0.45, ringSpeed: 0.07, nucleus: 0.8 };
    case 'EMERGENCY_STOP':
      return { ...base, primary: PALETTE.red, accent: PALETTE.red, lock: true, breath: 0, ringSpeed: 0, counterSpeed: 0, orbitSpeed: 0, energy: 'hold', nucleus: 0.55 };
    case 'OFFLINE':
      return { ...base, primary: PALETTE.mute, accent: PALETTE.mute, breath: 0.08, ringSpeed: 0.02, nucleus: 0.4 };
    default:
      break;
  }

  if (reducedMotion) {
    return { ...base, breath: 0, ringSpeed: 0, counterSpeed: 0, orbitSpeed: 0, waveform: false };
  }
  return base;
}

export function motionLocked(motion: PresenceCoreMotion): boolean {
  return motion.lock || motion.phase === 'EMERGENCY_STOP';
}

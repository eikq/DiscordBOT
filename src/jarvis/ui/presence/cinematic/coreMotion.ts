import type { PresencePhase } from '../presenceRuntime';

export type CoreEnergyDirection = 'in' | 'out' | 'hold';

export type PresenceCoreMotion = {
  phase: PresencePhase;
  primary: string;
  accent: string;
  fill: string;
  breath: number;
  ringSpeed: number;
  counterSpeed: number;
  orbitSpeed: number;
  gyroX: number;
  gyroY: number;
  gyroZ: number;
  ringOpen: number;
  density: number;
  energy: CoreEnergyDirection;
  energyAmount: number;
  lock: boolean;
  nucleus: number;
  instability: number;
  waveform: boolean;
  cameraZ: number;
  fov: number;
};

const PALETTE = {
  cyan: '#5ee7ff',
  ice: '#d7f7ff',
  teal: '#6ef0c8',
  amber: '#f0c36a',
  red: '#ff6b7a',
  mute: '#7d97a8',
  navy: '#16324c',
};

export function presenceCoreMotion(phase: PresencePhase, reducedMotion = false): PresenceCoreMotion {
  const base: PresenceCoreMotion = {
    phase,
    primary: PALETTE.cyan,
    accent: PALETTE.ice,
    fill: PALETTE.navy,
    breath: 0.28,
    ringSpeed: 0.11,
    counterSpeed: -0.07,
    orbitSpeed: 0.04,
    gyroX: 0.18,
    gyroY: 0.13,
    gyroZ: -0.09,
    ringOpen: 0,
    density: 0.55,
    energy: 'hold',
    energyAmount: 0.22,
    lock: false,
    nucleus: 0.86,
    instability: 0,
    waveform: false,
    cameraZ: 8.15,
    fov: 36,
  };

  let next = base;
  switch (phase) {
    case 'LISTENING':
      next = { ...base, breath: 0.82, waveform: true, nucleus: 1.18, ringSpeed: 0.22, ringOpen: 0.18, gyroX: 0.28, energyAmount: 0.4 };
      break;
    case 'UNDERSTANDING':
      next = { ...base, ringSpeed: 0.32, counterSpeed: -0.28, energy: 'in', energyAmount: 0.55, nucleus: 1.08, density: 0.7 };
      break;
    case 'THINKING':
      next = { ...base, ringSpeed: 0.28, orbitSpeed: 0.07, nucleus: 1.2, density: 0.88, gyroY: 0.22, energyAmount: 0.38 };
      break;
    case 'RESEARCHING':
      next = { ...base, energy: 'in', energyAmount: 0.7, ringSpeed: 0.2, orbitSpeed: 0.065, nucleus: 1.16, density: 0.8, cameraZ: 9.6, fov: 40 };
      break;
    case 'PLANNING':
      next = { ...base, ringSpeed: 0.16, orbitSpeed: 0.05, nucleus: 1.04, density: 0.72 };
      break;
    case 'EXECUTING':
      next = { ...base, energy: 'out', energyAmount: 0.78, primary: PALETTE.teal, ringSpeed: 0.24, nucleus: 1.14, gyroZ: -0.16 };
      break;
    case 'VERIFYING':
      next = { ...base, primary: PALETTE.teal, accent: PALETTE.cyan, energy: 'in', energyAmount: 0.5, ringSpeed: 0.07, gyroX: 0.05, gyroY: 0.04, gyroZ: -0.03, nucleus: 1.08 };
      break;
    case 'SPEAKING':
      next = { ...base, waveform: true, nucleus: 1.22, breath: 0.64, energyAmount: 0.45 };
      break;
    case 'WAITING_OWNER':
      next = { ...base, primary: PALETTE.amber, accent: PALETTE.amber, breath: 0.1, ringSpeed: 0.02, orbitSpeed: 0.008, gyroX: 0.02, gyroY: 0.015, gyroZ: -0.01, nucleus: 0.78, cameraZ: 8.4, fov: 34 };
      break;
    case 'EVOLVING':
      next = { ...base, ringSpeed: 0.12, orbitSpeed: 0.045, nucleus: 1.02 };
      break;
    case 'WARNING':
      next = { ...base, primary: PALETTE.amber, instability: 0.22, ringSpeed: 0.1 };
      break;
    case 'CRITICAL':
      next = { ...base, primary: PALETTE.red, instability: 0.45, ringSpeed: 0.08, nucleus: 0.74 };
      break;
    case 'EMERGENCY_STOP':
      next = {
        ...base,
        primary: PALETTE.red,
        accent: PALETTE.red,
        lock: true,
        breath: 0,
        ringSpeed: 0,
        counterSpeed: 0,
        orbitSpeed: 0,
        gyroX: 0,
        gyroY: 0,
        gyroZ: 0,
        energy: 'hold',
        energyAmount: 0,
        nucleus: 0.48,
        ringOpen: -0.08,
        cameraZ: 8.8,
      };
      break;
    case 'OFFLINE':
      next = { ...base, primary: PALETTE.mute, accent: PALETTE.mute, breath: 0.06, ringSpeed: 0.015, gyroX: 0.03, nucleus: 0.36 };
      break;
    default:
      break;
  }

  if (reducedMotion) {
    return {
      ...next,
      breath: 0,
      ringSpeed: 0,
      counterSpeed: 0,
      orbitSpeed: 0,
      gyroX: 0,
      gyroY: 0,
      gyroZ: 0,
      waveform: false,
      energyAmount: 0,
    };
  }
  return next;
}

export function motionLocked(motion: PresenceCoreMotion): boolean {
  return motion.lock || motion.phase === 'EMERGENCY_STOP';
}

export function energySign(motion: PresenceCoreMotion): number {
  if (motion.lock) return 0;
  if (motion.energy === 'in') return -1;
  if (motion.energy === 'out') return 1;
  return 0;
}

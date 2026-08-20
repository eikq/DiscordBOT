import type { VoiceTurnState } from './types';

const ALLOWED: Record<VoiceTurnState, readonly VoiceTurnState[]> = {
  IDLE: ['LISTENING', 'TRANSCRIBING', 'THINKING', 'WORKING', 'SPEAKING', 'WAITING_OWNER', 'ERROR'],
  LISTENING: ['TRANSCRIBING', 'THINKING', 'IDLE', 'ERROR'],
  TRANSCRIBING: ['THINKING', 'ERROR', 'IDLE'],
  THINKING: ['WORKING', 'SPEAKING', 'WAITING_OWNER', 'INTERRUPTED', 'LISTENING', 'ERROR', 'IDLE'],
  WORKING: ['SPEAKING', 'WAITING_OWNER', 'ERROR', 'IDLE', 'INTERRUPTED', 'LISTENING'],
  SPEAKING: ['IDLE', 'INTERRUPTED', 'WAITING_OWNER', 'LISTENING', 'ERROR'],
  INTERRUPTED: ['TRANSCRIBING', 'THINKING', 'LISTENING', 'WORKING', 'SPEAKING', 'WAITING_OWNER', 'IDLE', 'ERROR'],
  WAITING_OWNER: ['WORKING', 'SPEAKING', 'LISTENING', 'IDLE', 'ERROR'],
  ERROR: ['IDLE', 'LISTENING'],
};

export function canTransitionVoiceTurn(from: VoiceTurnState, to: VoiceTurnState): boolean {
  return ALLOWED[from].includes(to);
}

export function transitionVoiceTurn(from: VoiceTurnState, to: VoiceTurnState): VoiceTurnState {
  if (!canTransitionVoiceTurn(from, to)) {
    throw Object.assign(new Error(`Illegal voice turn transition ${from} → ${to}`), {
      reasonCode: 'PLAN_INVALID',
      from,
      to,
    });
  }
  return to;
}

export function visualStateForVoiceTurn(state: VoiceTurnState): string {
  if (state === 'WAITING_OWNER') return 'WAITING_PERMISSION';
  if (state === 'THINKING' || state === 'WORKING') return 'MODEL_GENERATING';
  if (state === 'TRANSCRIBING') return 'UNDERSTANDING';
  if (state === 'INTERRUPTED') return 'LISTENING';
  return state;
}

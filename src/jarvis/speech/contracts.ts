export type SpeechPhase = 'idle' | 'listening' | 'transcribing' | 'generating' | 'speaking' | 'cancelled' | 'barge_in';

export type SpeechTurnContract = {
  turnId: string;
  phase: SpeechPhase;
  cancelled: boolean;
  bargeIn: boolean;
  latency?: {
    captureMs?: number;
    sttMs?: number;
    ttsMs?: number;
    rvcMs?: number;
  };
};

export function applySpeechCancel(turn: SpeechTurnContract): SpeechTurnContract {
  return { ...turn, cancelled: true, phase: 'cancelled', bargeIn: false };
}

export function applyBargeIn(turn: SpeechTurnContract): SpeechTurnContract {
  return { ...turn, cancelled: true, bargeIn: true, phase: 'barge_in' };
}

export function speechTelemetryPayload(turn: SpeechTurnContract): Record<string, unknown> {
  return {
    turnId: turn.turnId,
    phase: turn.phase,
    cancelled: turn.cancelled,
    bargeIn: turn.bargeIn,
    latency: turn.latency ?? {},
  };
}

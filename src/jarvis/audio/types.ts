/**
 * Client-neutral audio capture types.
 * Jarvis Core must not import these; they exist for standalone mic/STT only.
 */

export type AudioInputState =
  | 'idle'
  | 'capturing'
  | 'unavailable'
  | 'permission-denied';

export type PcmFrame = {
  pcm: Uint8Array;
  sampleRate: number;
  channels: number;
  timestampMs: number;
};

export interface AudioInput {
  readonly id: string;
  getState(): AudioInputState;
  start(): Promise<void>;
  stop(): Promise<void>;
  onFrame(handler: (frame: PcmFrame) => void): () => void;
}

export type SpeechCaptureState = 'idle' | 'listening' | 'finalizing';

export type SpeechBusyPolicy = 'reject';

export type SpeechTurn = {
  turnId: string;
  pcm: Uint8Array;
  sampleRate: number;
  channels: number;
  captureDurationMs: number;
  voicedMs: number;
  utteranceFinalizeMs?: number;
  reason: 'silence' | 'stop' | 'max-duration';
};

export type SpeechTurnIgnoreReason = 'too-short' | 'noise-only' | 'empty';
export type SpeechTurnRejectReason = 'busy' | 'not-listening';

export const STT_PCM_SAMPLE_RATE = 48_000;
export const STT_PCM_CHANNELS = 2;
export const STANDALONE_MIC_SOURCE = 'desktop' as const;

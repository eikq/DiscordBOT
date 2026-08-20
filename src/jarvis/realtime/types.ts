/**
 * Realtime voice interaction architecture.
 * Transport-agnostic. Does not persist raw audio. Not LIVE_VERIFIED.
 */

export const VOICE_TURN_STATES = [
  'IDLE',
  'LISTENING',
  'TRANSCRIBING',
  'THINKING',
  'WORKING',
  'SPEAKING',
  'INTERRUPTED',
  'WAITING_OWNER',
  'ERROR',
] as const;
export type VoiceTurnState = (typeof VOICE_TURN_STATES)[number];

export const INTERRUPTION_KINDS = [
  'question',
  'correction',
  'stop',
  'new_command',
  'unknown',
] as const;
export type InterruptionKind = (typeof INTERRUPTION_KINDS)[number];

export const PLAYBACK_CLOCK_SOURCES = ['speech', 'bootstrap_estimate', 'seek'] as const;
export type PlaybackClockSource = (typeof PLAYBACK_CLOCK_SOURCES)[number];

export type VoiceWorkAction = 'none' | 'pause' | 'cancel';

export type BargeInDecision = {
  kind: InterruptionKind;
  cancelPlayback: boolean;
  workAction: VoiceWorkAction;
  preserveTask: true;
  mutatingWork: boolean;
  nextState: VoiceTurnState;
  reason: string;
};

export type StreamingDecision = {
  mayBeginPresentation: boolean;
  claimSuccess: false | true;
  reason: string;
};

export type SttLifecycleStatus = 'idle' | 'listening' | 'transcribing' | 'done' | 'unavailable' | 'error';
export type TtsLifecycleStatus = 'idle' | 'synthesizing' | 'speaking' | 'cancelled' | 'unavailable' | 'done';

export type SttPort = {
  available(): boolean;
  listen(): void;
  transcribe(turnId: string, text: string): Promise<{ text: string; status: 'ok' | 'unavailable' | 'error' }>;
  status(): SttLifecycleStatus;
};

export type TtsPort = {
  available(): boolean;
  speak(turnId: string, text: string): Promise<{ status: 'spoken' | 'cancelled' | 'unavailable' }>;
  cancel(turnId: string): Promise<void>;
  resume(turnId: string): Promise<{ status: 'spoken' | 'cancelled' | 'unavailable' }>;
  status(): TtsLifecycleStatus;
  elapsedMs(): number;
};

export type VoiceTurnSnapshot = {
  state: VoiceTurnState;
  turnId: string | null;
  cancelled: boolean;
  bargeInActive: boolean;
  interruptionKind?: InterruptionKind;
  playbackSource: PlaybackClockSource;
  playbackElapsedMs: number;
  personaProfileId: string;
  voiceProfileId: string;
  provider?: 'stt' | 'tts' | 'none';
  error?: string;
};

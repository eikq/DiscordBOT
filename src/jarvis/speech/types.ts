export type VoiceResourcePhase = 'listening' | 'thinking' | 'speaking';

export type VoiceRouteKind = 'native' | 'clone';

export type SourceTtsEngine = 'edge' | 'jaitts';

export type VoiceOutputStatus =
  | 'spoken'
  | 'cancelled'
  | 'skipped'
  | 'unavailable'
  | 'degraded';

export type VoiceProfile = {
  profileId: string;
  kind: VoiceRouteKind;
  usesRvc: boolean;
  speakerId?: string;
};

export type VoiceTurnContext = {
  turnId: string;
  sessionId?: string;
  text: string;
  personaProfileId?: string;
};

export type VoiceOutputTimings = {
  sourceTtsMs?: number;
  rvcMs?: number;
  totalMs: number;
  sourceEngine?: SourceTtsEngine;
};

export type VoiceOutputResult = {
  status: VoiceOutputStatus;
  turnId: string;
  profileId: string;
  spokenProfileId?: string;
  fallback: boolean;
  reason?: string;
  mime?: string;
  audioBase64?: string;
  audioDurationMs?: number;
  timings: VoiceOutputTimings;
  resourcePhase: VoiceResourcePhase;
};

export interface VoiceOutputRouter {
  speak(text: string, profile: VoiceProfile, turn: VoiceTurnContext): Promise<VoiceOutputResult>;
  cancel(turnId: string): Promise<void>;
  resolveProfile(profileId: string): VoiceProfile;
  probeProfile(profileId: string): Promise<{
    profileId: string;
    available: boolean;
    speechActive: boolean;
    consented?: boolean;
    reason?: string;
    runtimeState: 'selected' | 'loading' | 'ready' | 'speaking' | 'unavailable' | 'degraded';
  }>;
}

export type SourceTtsResult = {
  audio: Buffer;
  mime: string;
  engine: SourceTtsEngine;
  latencyMs: number;
};

export type SourceTtsSynthesizer = {
  synthesize(text: string, turnId: string, engine: SourceTtsEngine): Promise<SourceTtsResult>;
  cancel(turnId: string): Promise<void>;
};

export type RvcConverter = {
  convert(audio: Buffer, mime: string, speakerId: string, turnId: string): Promise<{ audio: Buffer; mime: string; latencyMs: number }>;
  cancel(turnId: string): Promise<void>;
};

export type CloneConsentGate = {
  isCloneConsented(profileId: string): boolean;
};

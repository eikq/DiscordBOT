export const JARVIS_BRAIN_ID = 'jarvis';
export const JARVIS_PERSONA_ID = 'jarvis';
export const JARVIS_VOICE_ID = 'jarvis';

export type PersonaMode = 'NONE' | 'STYLE' | 'SOCIAL';
export type PresentationLanguage = 'th' | 'en' | 'auto';
export type PresentationVerbosity = 'short' | 'normal' | 'detailed';
export type PresentationHumor = 'off' | 'light' | 'natural';
export type MemoryDomain = 'global' | 'discord' | 'persona' | 'restricted';

export interface PresentationProfile {
  brainProfileId: string;
  personaProfileId: string;
  voiceProfileId: string;
  personaMode: PersonaMode;
  language: PresentationLanguage;
  verbosity: PresentationVerbosity;
  humor: PresentationHumor;
}

export type PresentationOverride = Partial<Pick<
  PresentationProfile,
  'brainProfileId' | 'personaProfileId' | 'voiceProfileId' | 'personaMode' | 'language' | 'verbosity' | 'humor'
>>;

export interface PresentationSessionState {
  sessionId: string;
  defaultProfile: PresentationProfile;
  activeProfile: PresentationProfile;
  expiresAt?: string;
}

export interface PresentationContext {
  sessionId: string;
  speakerUserId?: string;
  behaviorPersonaId?: string;
}

export interface PresentedResponse {
  text: string;
  personaProfileId: string;
  voiceProfileId: string;
  transformations: string[];
  behaviorPersonaId?: string;
}

export interface VoiceProfileAvailability {
  profileId: string;
  available: boolean;
  consented?: boolean;
  modelSelection?: 'best' | 'latest';
  reason?: string;
}

export interface VoiceProfileResolver {
  resolve(profileId: string): Promise<VoiceProfileAvailability>;
}

export interface JarvisPersonaProfile {
  profileId: string;
  displayName: string;
  aliases: string[];
  styleNotes?: string;
}

export interface BehaviorExample {
  id: string;
  ownerResponse: string;
  prompt?: string;
}

export interface PersonaProvider {
  get(profileId: string): Promise<JarvisPersonaProfile | null>;
  getBehaviorExamples(profileId: string, query: string, limit?: number): Promise<BehaviorExample[]>;
}

export interface InvocationResolution {
  contentText: string;
  oneTurnOverride?: PresentationOverride;
  sessionUpdate?: PresentationOverride;
  confidence: number;
}

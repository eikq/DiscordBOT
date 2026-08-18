import type { PresentationProfile } from '../presentation/types';

/**
 * Presentation-neutral Jarvis Core contracts.
 *
 * This module must not import Discord, BotService, TTS, or RVC.
 * Persona and voice belong on PresentationProfile / PresentedResponse, not on
 * JarvisCoreResult.
 */
export type JarvisClientSource = 'discord' | 'desktop' | 'android' | 'cctv' | 'system';

export interface JarvisClientContext {
  sessionId: string;
  guildId?: string;
  channelId?: string;
  speakerUserId?: string;
  participants?: string[];
}

export interface VerifiedFact {
  key: string;
  value: unknown;
  sourceType: 'tool' | 'memory' | 'system' | 'user';
  sourceRef?: string;
  confidence?: number;
  immutableForPresentation: boolean;
}

export interface Claim {
  text: string;
  confidence: number;
}

export interface ToolResultRef {
  toolName: string;
  status: 'ok' | 'unavailable' | 'error';
  sourceUrls?: string[];
  summary?: string;
}

export interface MemoryRef {
  canonicalId: string;
  domain: 'global' | 'discord' | 'persona' | 'restricted';
}

export interface ActionResult {
  name: string;
  status: 'planned' | 'completed' | 'denied' | 'failed';
  detail?: string;
}

export interface JarvisRequest {
  requestId: string;
  source: JarvisClientSource;
  input: {
    text: string;
    language?: string;
  };
  clientContext: JarvisClientContext;
  presentation: PresentationProfile;
  capabilities: string[];
}

export interface JarvisCoreResult {
  requestId: string;
  answerIntent: string;
  verifiedFacts: VerifiedFact[];
  unverifiedClaims: Claim[];
  toolResults: ToolResultRef[];
  memoryRefs: MemoryRef[];
  actionResults: ActionResult[];
  uncertainty: string[];
  suggestedContent: string;
}

export type ReasoningResult = JarvisCoreResult;

export interface JarvisCore {
  handle(request: JarvisRequest): Promise<JarvisCoreResult>;
}

export interface JarvisResponse {
  requestId: string;
  reasoning: JarvisCoreResult;
  presentation: {
    text: string;
    personaProfileId: string;
    voiceProfileId: string;
  };
  actions?: ActionResult[];
}

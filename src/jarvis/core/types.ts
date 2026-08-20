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
  /** Optional opaque group/session id from any client. Not a Discord.js type. */
  guildId?: string;
  /** Optional opaque channel/conversation id from any client. */
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
  facts?: {
    systemSnapshot?: {
      summary?: string;
      parts?: string[];
      cpu?: { usagePct: number; cores: number };
      ram?: { usedPct: number; freeMb?: number; totalMb?: number };
      disk?: { usedPct?: number; freeGb?: number; totalGb?: number };
      gpu?: { name: string; utilizationPct?: number; vramUsedMb?: number; vramTotalMb?: number };
    };
    displays?: {
      count: number;
      ids: string[];
      names?: string[];
      currentName?: string;
      currentId?: string;
      hostKind?: string;
      reason?: string;
    };
  };
}

export interface MemoryRef {
  canonicalId: string;
  domain: 'global' | 'discord' | 'persona' | 'restricted';
  type?: string;
  confidence?: number;
  sourceRefs?: string[];
  status?: string;
  text?: string;
  sourceSystem?: string;
  memoryClass?: string;
  ownerTrusted?: boolean;
  derived?: boolean;
}

export interface SkillRef {
  id: string;
  source: string;
  version?: string;
}

export type ActionResultStatus =
  | 'planned'
  | 'completed'
  | 'denied'
  | 'failed'
  | 'confirmation_required'
  | 'unavailable';

export interface ActionResult {
  name: string;
  status: ActionResultStatus;
  detail?: string;
  proposalId?: string;
  capabilityId?: string;
  summary?: string;
  risk?: 'READ_ONLY' | 'LOW_RISK_ACTION' | 'CONFIRM_REQUIRED' | 'BLOCKED';
  errorCode?: string;
  startedAt?: string;
  completedAt?: string;
}

export interface CapabilityCall {
  id: string;
  input?: Record<string, unknown>;
  confirmation?: {
    proposalId: string;
    token: string;
  };
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
  capabilityCalls?: CapabilityCall[];
  actionOnly?: boolean;
  presetActionResults?: ActionResult[];
  actionSource?: 'text' | 'voice' | 'ui' | 'system';
}

export interface JarvisCoreResult {
  requestId: string;
  answerIntent: string;
  verifiedFacts: VerifiedFact[];
  unverifiedClaims: Claim[];
  toolResults: ToolResultRef[];
  memoryRefs: MemoryRef[];
  /** Vetted instruction/reference skills that materially shaped this result. */
  skillRefs?: SkillRef[];
  documentRefs?: string[];
  sourceRefs?: string[];
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

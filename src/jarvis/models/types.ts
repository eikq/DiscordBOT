export const MODEL_TRUST_TIERS = ['STANDARD', 'EXPERIMENTAL', 'RESTRICTED'] as const;
export type ModelTrustTier = (typeof MODEL_TRUST_TIERS)[number];

export const ALIGNMENT_STATUSES = [
  'unknown',
  'aligned_unverified',
  'abliterated_unverified',
] as const;
export type AlignmentStatus = (typeof ALIGNMENT_STATUSES)[number];

export const EVIDENCE_STATES = ['unverified', 'fixture_only', 'locally_verified'] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export type ModelProfile = {
  id: string;
  family: string;
  engineCompatibility: string[];
  local: boolean;
  cloud: boolean;
  quantization?: string;
  contextTokens?: number;
  vision: EvidenceState;
  toolCalling: EvidenceState;
  reasoning: EvidenceState;
  structuredOutput: EvidenceState;
  thai: EvidenceState;
  coding: EvidenceState;
  agent: EvidenceState;
  resourceRequirements: string;
  trustTier: ModelTrustTier;
  alignmentStatus: AlignmentStatus;
  lastLocallyVerified: string | null;
  /** RESTRICTED specialists never become the permission system. */
  securityAuthority: false;
};

export const CERT_CATEGORIES = [
  'chat',
  'thai',
  'structured_output',
  'tool_calling',
  'multi_step_tools',
  'coding',
  'research',
  'context_retention',
  'vision',
  'recovery',
] as const;
export type CertCategory = (typeof CERT_CATEGORIES)[number];

export type CertificationStatus = 'FIXTURE_ONLY' | 'BLOCKED_LOCAL_ACCEPTANCE' | 'CERTIFIED';

export type CertificationResult = {
  category: CertCategory;
  passed: boolean;
  detail: string;
  simulated: boolean;
};

export type CertificationRun = {
  id: string;
  at: string;
  modelProfileId: string;
  status: CertificationStatus;
  liveOllama: false;
  results: CertificationResult[];
};

export type ModelRouteIntent =
  | 'casual_chat'
  | 'deep_reasoning'
  | 'coding'
  | 'voice'
  | 'night_background';

export type HardwareRoutingHint = {
  idle?: boolean;
  ramBytes?: number;
  vramBytes?: number;
};

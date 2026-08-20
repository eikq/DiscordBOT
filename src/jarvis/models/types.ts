export const MODEL_TRUST_TIERS = ['STANDARD', 'EXPERIMENTAL', 'RESTRICTED'] as const;
export type ModelTrustTier = (typeof MODEL_TRUST_TIERS)[number];

export const ALIGNMENT_STATUSES = [
  'unknown',
  'aligned_unverified',
  'abliterated_unverified',
] as const;
export type AlignmentStatus = (typeof ALIGNMENT_STATUSES)[number];

/** Unknown abilities stay unknown/unverified. Never invent a pass. */
export const EVIDENCE_STATES = [
  'unknown',
  'unverified',
  'fixture_only',
  'cloud_verified',
  'locally_verified',
] as const;
export type EvidenceState = (typeof EVIDENCE_STATES)[number];

export const UNKNOWN_ABILITY: EvidenceState = 'unverified';

export type LatencyEvidence = {
  source: EvidenceState;
  p50Ms?: number;
  p95Ms?: number;
};

export type ThroughputEvidence = {
  source: EvidenceState;
  tokensPerSec?: number;
};

export type HardwareRequirements = {
  notes: string;
  measured: boolean;
  ramBytes?: number;
  vramBytes?: number;
};

export type ModelProfile = {
  id: string;
  modelId: string;
  provider: string;
  engine: string;
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
  research: EvidenceState;
  recovery: EvidenceState;
  contextCapability: EvidenceState;
  latencyEvidence: LatencyEvidence;
  throughputEvidence: ThroughputEvidence;
  hardwareRequirements: HardwareRequirements;
  resourceRequirements: string;
  trustTier: ModelTrustTier;
  alignmentStatus: AlignmentStatus;
  lastLocallyVerified: string | null;
  certificationState: CertificationStatus | 'UNVERIFIED';
  available: boolean;
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

/** Cloud may emit FIXTURE_ONLY or CLOUD_VERIFIED. Never LIVE_VERIFIED. */
export type CertificationStatus = 'FIXTURE_ONLY' | 'CLOUD_VERIFIED' | 'BLOCKED_LOCAL_ACCEPTANCE' | 'CERTIFIED';

export type CloudCertificationLabel = 'FIXTURE_ONLY' | 'CLOUD_VERIFIED';

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
  liveVerified: false;
  results: CertificationResult[];
};

export const MODEL_WORKLOADS = [
  'casual',
  'information',
  'deep_reasoning',
  'research',
  'coding',
  'voice_realtime',
  'night_background',
  'vision',
] as const;
export type ModelWorkload = (typeof MODEL_WORKLOADS)[number];

/** @deprecated Prefer ModelWorkload. Aliases remain for existing callers. */
export type ModelRouteIntent =
  | ModelWorkload
  | 'casual_chat'
  | 'voice';

export type HardwareRoutingHint = {
  idle?: boolean;
  /** Only runtime-measured idle counts. Assumed idle is ignored. */
  idleSource?: 'runtime' | 'assumed';
  ramBytes?: number;
  vramBytes?: number;
  availableModelIds?: string[];
  latencyBudgetMs?: number;
  minContextTokens?: number;
  preferredModelId?: string;
};

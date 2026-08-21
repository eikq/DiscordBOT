import type {
  CapabilityAvailability,
  CapabilityDistributionClass,
  CapabilityExecutionMode,
  CapabilityMaturity,
  CapabilityPermissionClass,
  CapabilityProviderKind,
  JsonSchema,
} from '../capabilities/types';
import type { CapabilityAssessment } from '../evolution/selfModel';
import type { ModelCertification, ModelProfile } from '../models/types';
import type { GoalKnowledge } from '../goals/types';

export const CAPABILITY_INTELLIGENCE_STATUSES = [
  'AVAILABLE',
  'DEGRADED',
  'NEEDS_CONFIGURATION',
  'NEEDS_OWNER_INPUT',
  'NEEDS_PERMISSION',
  'NEEDS_DEPENDENCY',
  'NEEDS_PROVIDER',
  'SIMULATION',
  'BLOCKED_LOCAL_ACCEPTANCE',
  'UNAVAILABLE',
  'UNSUPPORTED',
  'POLICY_BLOCKED',
  'UNKNOWN',
] as const;

export type CapabilityIntelligenceStatus = (typeof CAPABILITY_INTELLIGENCE_STATUSES)[number];

export const OBJECTIVE_BLOCKERS = [
  'MISSING_CAPABILITY',
  'MISSING_PROVIDER',
  'MISSING_DEPENDENCY',
  'MISSING_CONFIGURATION',
  'MISSING_CREDENTIAL',
  'OWNER_INPUT_REQUIRED',
  'PERMISSION_REQUIRED',
  'PRIVILEGE_REQUIRED',
  'SERVICE_UNAVAILABLE',
  'MODEL_UNSUITABLE',
  'LOCAL_ACCEPTANCE_REQUIRED',
  'POLICY_BLOCKED',
  'EXTERNAL_SYSTEM_LIMITATION',
  'UNSUPPORTED_PROTOCOL',
  'INSUFFICIENT_EVIDENCE',
  'UNKNOWN',
] as const;

export type ObjectiveBlockerCode = (typeof OBJECTIVE_BLOCKERS)[number];

export type CapabilityRequirementEvidence = {
  providers: string[];
  services: string[];
  configuration: string[];
  ownerInput: string[];
  dependencies: string[];
};

export type CapabilityPermissionEvidence = {
  class: CapabilityPermissionClass;
  ownerApprovalRequired: boolean;
  privilegeRequired: boolean;
  authorityGranted: false;
};

export type SelfKnowledgeCapability = {
  id: string;
  displayName: string;
  description: string;
  registered: boolean;
  status: CapabilityIntelligenceStatus;
  reason: string;
  implementation: {
    maturity: CapabilityMaturity;
    mode: CapabilityExecutionMode;
    source: 'registry' | 'provider_contract';
  };
  runtime: {
    availability: CapabilityAvailability | 'unknown';
    degraded: boolean;
    checkedAt: string;
  };
  provider: {
    kind: CapabilityProviderKind | 'contract';
    requiredService: string;
  };
  permission: CapabilityPermissionEvidence;
  localAcceptance: 'NOT_REQUIRED' | 'BLOCKED_LOCAL_ACCEPTANCE';
  distribution: CapabilityDistributionClass[];
  contracts: { input: JsonSchema; output: JsonSchema };
  support: {
    cancellation: 'cooperative' | 'not_supported';
    verification: 'registered' | 'not_registered';
    rollback: 'registered' | 'not_registered';
  };
  sideEffect: 'read' | 'write';
  untrustedOutput: boolean;
  requirements: CapabilityRequirementEvidence;
  knownLimitations: string[];
  competence?: CapabilityAssessment;
  evidence: string[];
};

export type DeclaredCapabilityEvidence = Omit<
  SelfKnowledgeCapability,
  'registered' | 'runtime' | 'competence' | 'evidence'
> & {
  runtime?: Partial<SelfKnowledgeCapability['runtime']>;
  evidence: string[];
};

export type SelfKnowledgeService = {
  id: string;
  state: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'UNKNOWN';
  detail?: string;
  evidence: string[];
};

export type SelfKnowledgeModel = {
  profile: ModelProfile;
  certifications: ModelCertification[];
  providerState: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
  limitations: string[];
};

export type SelfKnowledgeSnapshot = {
  generatedAt: string;
  identity: {
    name: 'Jarvis';
    role: 'local owner assistant';
    thaiFirst: true;
    notConscious: true;
    ownerRelationship: 'owner_sovereignty';
    trustBoundaries: string[];
  };
  models: SelfKnowledgeModel[];
  capabilities: SelfKnowledgeCapability[];
  services: SelfKnowledgeService[];
  providers: Array<{
    id: string;
    kind: string;
    state: 'ACTIVE' | 'DEGRADED' | 'UNAVAILABLE' | 'SIMULATION' | 'PREPARE_CONTRACT' | 'UNKNOWN';
    capabilities: string[];
  }>;
  competence: CapabilityAssessment[];
  goals: GoalKnowledge[];
  unknowns: string[];
};

export type CapabilityDependencyRelation = 'REQUIRED' | 'OPTIONAL' | 'ALTERNATIVE';

export type CapabilityDependency = {
  capabilityId: string;
  relation: CapabilityDependencyRelation;
  alternativeGroup?: string;
};

export type CapabilityGoalDefinition = {
  id: string;
  title: string;
  dependencies: CapabilityDependency[];
  allowSimulation?: boolean;
};

export type CapabilityGraphResolution = {
  goal: CapabilityGoalDefinition;
  selected: string[];
  missing: Array<{
    capabilityId: string;
    relation: CapabilityDependencyRelation;
    status: CapabilityIntelligenceStatus;
    reason: string;
  }>;
  optionalUnavailable: string[];
  ready: boolean;
  evidence: string[];
};

export type GapResolutionPathKind =
  | 'USE_EXISTING_CAPABILITY'
  | 'COMPOSE_EXISTING_CAPABILITIES'
  | 'RESTORE_OR_CONFIGURE_PROVIDER'
  | 'USE_INSTALLED_SAFE_TOOL'
  | 'RESEARCH_TRUSTED_DOCUMENTATION'
  | 'SELECT_CERTIFIED_MODEL'
  | 'PREPARE_ADAPTER_OR_PROVIDER'
  | 'PREPARE_SKILL_CANDIDATE'
  | 'REQUEST_OWNER_INPUT'
  | 'REPORT_BLOCKER';

export type GapResolutionPath = {
  kind: GapResolutionPathKind;
  priority: number;
  title: string;
  capabilityIds: string[];
  risk: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'UNKNOWN';
  ownerInputRequired: string[];
  permissionRequired: string[];
  externalDependencies: string[];
  researchRequired: boolean;
  executableNow: boolean;
  inputCompatible: boolean;
  trustRequired: boolean;
};

export type GapResolutionPlan = {
  goal: string;
  status: 'READY' | 'NEEDS_OWNER' | 'BLOCKED';
  missing: Array<{
    capabilityId: string;
    blocker: ObjectiveBlockerCode;
    currentState: CapabilityIntelligenceStatus;
    reason: string;
  }>;
  possiblePaths: GapResolutionPath[];
  recommendedPath?: GapResolutionPath;
  ownerInputRequired: string[];
  permissionRequired: string[];
  verificationStrategy: string[];
  confidence: number | null;
  evidence: string[];
  boundedAttempts: { attempted: number; maximum: number };
};

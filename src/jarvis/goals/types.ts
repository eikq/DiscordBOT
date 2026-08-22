import type { CapabilityDependency } from '../intelligence/types';

export const GOAL_SCOPES = [
  'PUBLIC_WEB',
  'PRIVATE_BROWSER',
  'WORKSPACE',
  'DOCUMENT',
  'SYSTEM',
  'AUTOMATION',
  'SELF_KNOWLEDGE',
  'OWNER_DEVICE',
  'OWNER_SELECTED_SOURCE',
  'DESKTOP',
  'SOFTWARE',
] as const;

export type GoalScope = (typeof GOAL_SCOPES)[number];
export type GoalMaturity = 'REAL' | 'PARTIAL' | 'PREPARE_CONTRACT';
export type GoalHandlerKind = 'CAPABILITY_PLAN' | 'SELF_KNOWLEDGE';
export type GoalRisk = 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type GoalInputDefinition = {
  id: string;
  description: string;
  required: boolean;
  smallestQuestion?: string;
};

export type GoalRouteStep = {
  capabilityId: string;
  adapterId?: string;
};

export type GoalRouteDefinition = {
  id: string;
  title: string;
  priority: number;
  scope: GoalScope;
  risk: GoalRisk;
  ownerDecisionRequired?: boolean;
  steps: GoalRouteStep[];
  dependencies: CapabilityDependency[];
};

export type GoalDefinition = {
  id: string;
  version?: number;
  name: string;
  description: string;
  scope: GoalScope;
  handler: GoalHandlerKind;
  examples: string[];
  matchingHints: string[];
  requiredInputs: GoalInputDefinition[];
  optionalInputs: GoalInputDefinition[];
  routes: GoalRouteDefinition[];
  expectedOutcome: string;
  verificationExpectation: string;
  permissionImplications: string;
  maturity: GoalMaturity;
  allowedCapabilityPrefixes: string[];
  distribution?: Array<'CORE' | 'OWNER_ONLY' | 'COMMUNITY_EXCLUDED' | 'DEMO_EXCLUDED'>;
};

export const INPUT_COMPATIBILITY_STATES = [
  'DIRECT_COMPATIBLE',
  'ADAPTER_COMPATIBLE',
  'MISSING_REQUIRED_INPUT',
  'INCOMPATIBLE',
  'UNKNOWN',
] as const;

export type InputCompatibility = (typeof INPUT_COMPATIBILITY_STATES)[number];

export type GoalResolvedStep = {
  capabilityId: string;
  input: Record<string, unknown>;
  compatibility: InputCompatibility;
  adapterId?: string;
  evidence: string[];
};

export type GoalResolvedRoute = {
  id: string;
  title: string;
  priority: number;
  scope: GoalScope;
  risk: GoalRisk;
  ownerDecisionRequired: boolean;
  available: boolean;
  inputCompatible: boolean;
  steps: GoalResolvedStep[];
  reason: string;
  evidence: string[];
};

export type GoalResolutionStatus =
  | 'RESOLVED'
  | 'NEEDS_INPUT'
  | 'NEEDS_OWNER_DECISION'
  | 'CLARIFICATION'
  | 'BLOCKED'
  | 'NO_MATCH';

export type GoalResolution = {
  status: GoalResolutionStatus;
  goalId?: string;
  goalName?: string;
  scope?: GoalScope;
  handler?: GoalHandlerKind;
  matchedIntent: string;
  matchSource: 'deterministic' | 'validated_suggestion' | 'none';
  confidence: number | null;
  extractedInputs: Record<string, unknown>;
  missingInputs: string[];
  smallestOwnerQuestion?: string;
  routes: GoalResolvedRoute[];
  selectedRouteId?: string;
  rejectedAlternatives: Array<{ routeId: string; reason: string }>;
  permissionRequired: string[];
  verificationStrategy: string[];
  evidence: string[];
  boundedAttempts: { attempted: number; maximum: number };
};

export type GoalSuggestion = {
  goalId: string;
  confidence: number;
  extractedFields?: Record<string, unknown>;
};

export type GoalKnowledgeStatus =
  | 'CAN_DO_NOW'
  | 'NEEDS_APPROVAL'
  | 'AFTER_SETUP'
  | 'PARTIAL'
  | 'CANNOT_COMPLETE';

export type GoalKnowledge = {
  id: string;
  name: string;
  description: string;
  scope: GoalScope;
  maturity: GoalMaturity;
  status: GoalKnowledgeStatus;
  reason: string;
  capabilityIds: string[];
  permissionImplications: string;
  verificationExpectation: string;
  evidence: string[];
};

export type GoalOutcomeEvidence = {
  goalId: string;
  outcome: 'success' | 'partial' | 'failure';
  verificationState?: import('../safety/types').VerificationState;
  capabilityOutcomes: Array<{ capabilityId: string; status: string }>;
  evidenceRefs: string[];
};

import type { DisplaySelector } from '../desktop/monitorTopology';
import type { ContextEvidence } from './contextEvidence';
import type { OwnerAliasRecord } from '../memory/ownerSemantics';
import type { ResearchSourceRef } from '../memory/activeContext';
import type { CapabilityHost } from '../capabilities/types';
import type { GoalCatalog, GoalResolution, GoalSuggestion, TrustedInputAdapterRegistry } from '../goals';

export type ActionabilityClass =
  | 'ACTIONABLE'
  | 'INFORMATION'
  | 'CONVERSATION'
  | 'AMBIGUOUS'
  | 'FORBIDDEN';

export type IntentKind =
  | 'CAPABILITY'
  | 'CLARIFICATION'
  | 'CONVERSATION'
  | 'UNSUPPORTED'
  | 'FORBIDDEN';

export type IntentSource = 'fast-path' | 'context' | 'heuristic' | 'semantic';

export type IntentConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type CompactCapability = {
  id: string;
  shortDescription: string;
  argumentSchemaSummary: string;
  sideEffectClass: 'READ_ONLY' | 'LOW_RISK_ACTION' | 'CONFIRM_REQUIRED';
  availability: 'up' | 'unavailable' | 'unknown';
};

export type IntentAlternative = {
  capabilityId: string;
  arguments?: Record<string, unknown>;
  label: string;
};

export type ClarificationState = {
  clarificationId: string;
  originalRequestId: string;
  question: string;
  candidateIntents: Array<{
    capabilityId: string;
    arguments?: Record<string, unknown>;
    label: string;
  }>;
  expiresAt: number;
};

export type IntentResolution = {
  kind: IntentKind;
  capabilityId?: string;
  arguments?: Record<string, unknown>;
  confidence: IntentConfidence;
  ambiguity?: string;
  alternatives?: IntentAlternative[];
  reasonCode: string;
  userMessage?: string;
  consumed?: boolean;
  source: IntentSource;
  actionClass: ActionabilityClass;
  clarification?: ClarificationState;
  goal?: GoalResolution;
  pendingGoalId?: string;
  pendingGoalExpiresAt?: string;
  extraCalls?: Array<{ id: string; input?: Record<string, unknown> }>;
  contextEvidence?: ContextEvidence;
};

export type InteractionContext = {
  sessionId: string;
  activeIntent?: string;
  lastCapabilityId?: string;
  lastServiceId?: string;
  lastApplicationId?: string;
  lastSettingsId?: string;
  lastOpenedResource?: {
    kind: 'application' | 'url';
    applicationId?: string;
    url?: string;
    label: string;
    display?: DisplaySelector | null;
    openState?: 'intended' | 'opened';
    processName?: string;
    windowHandle?: string;
    managedWindowId?: string;
    openOperationId?: string;
    currentDisplayId?: string;
    previousDisplayId?: string;
    placementScope?: 'managed-window' | 'process-window' | 'unknown';
  };
  lastDisplay?: DisplaySelector | null;
  previousDisplay?: DisplaySelector | null;
  currentWebsite?: string;
  currentApplication?: string;
  currentWindow?: string;
  currentSource?: string;
  currentResearch?: string;
  currentWorkspace?: string;
  currentDisplay?: DisplaySelector | null;
  lastResearchSources?: ResearchSourceRef[];
  conversationLanguage?: 'th' | 'en';
  pendingContainmentId?: string;
  lastQuery?: string;
  recentResearchSessionId?: string;
  recentResearchQuery?: string;
  recentWorkspaceId?: string;
  recentDocumentIds?: string[];
  recentDocumentQuery?: string;
  recentDocumentEvidenceIds?: string[];
  recentReminderIds?: string[];
  pendingClarification?: ClarificationState;
  pendingProposalId?: string;
  candidateTargets?: string[];
  updatedAt: number;
  expiresAt: number;
};

export type IntentResolveOptions = {
  sessionId?: string;
  applicationIds?: string[];
  projectIds?: string[];
  catalog?: CompactCapability[];
  context?: InteractionContext | null;
  now?: number;
  capabilityHost?: CapabilityHost;
  goalCatalog?: GoalCatalog;
  inputAdapters?: TrustedInputAdapterRegistry;
  goalSuggestion?: GoalSuggestion;
  aliases?: OwnerAliasRecord[];
  semanticResolve?: (input: {
    text: string;
    catalog: CompactCapability[];
    context?: InteractionContext | null;
  }) => Promise<unknown> | unknown;
};

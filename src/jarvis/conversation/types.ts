/**
 * Typed conversation working memory.
 * CONTEXT != AUTHORITY. This never grants effects, leases, or capabilities.
 */

export const DISCOURSE_ACTS = [
  'GREET',
  'ACKNOWLEDGE',
  'STATUS_QUERY',
  'MODEL_QUERY',
  'MEMORY_QUERY',
  'MEMORY_STORE',
  'CONTINUE',
  'PAUSE',
  'CANCEL',
  'EXECUTE_NOW',
  'APPROVE_PLAN',
  'GRANT_PERMISSION',
  'RERUN',
  'TEST',
  'BUILD',
  'PREVIEW',
  'STOP_PREVIEW',
  'RESTART_PREVIEW',
  'INSPECT_PROJECT',
  'MODIFY_PROJECT',
  'ACCUMULATE_REQUIREMENTS',
  'PLAN_REQUEST',
  'NEW_PROJECT',
  'RESEARCH',
  'SWITCH_TOPIC',
  'RESTORE_TOPIC',
  'START_FRESH',
  'CORRECT',
  'NEGATE',
  'SELECT_ORDINAL',
  'CONDITIONAL',
  'QUEUE',
  'AMBIGUOUS',
  'UNKNOWN',
] as const;

export type DiscourseAct = (typeof DISCOURSE_ACTS)[number];

export const REFERENT_SLOTS = [
  'this_project',
  'this_site',
  'this_app',
  'this_file',
  'this_plan',
  'this_preview',
  'this_error',
  'this_result',
  'previous_option',
  'current_option',
] as const;

export type ReferentSlot = (typeof REFERENT_SLOTS)[number];

export type ConversationTopicKind =
  | 'idle'
  | 'chat'
  | 'software'
  | 'research'
  | 'permission'
  | 'memory'
  | 'queue';

export type ProjectRecord = {
  slug: string;
  label: string;
  kind: 'website' | 'software';
  goalId?: string;
  planId?: string;
  workspace?: string;
  previewUrl?: string;
  processRef?: string;
};

export type OfferedOption = {
  index: number;
  label: string;
  payload?: string;
};

export type RecentOperation = {
  kind: 'test' | 'build' | 'preview' | 'install' | 'write' | 'plan' | 'research' | 'inspect' | 'stop';
  capabilityId?: string;
  slug?: string;
  ok?: boolean;
  summary?: string;
  files?: string[];
  at: number;
};

export type TopicFrame = {
  topic: ConversationTopicKind;
  projectSlug?: string;
  goalId?: string;
  planId?: string;
  label?: string;
};

export type QueueItem = {
  id: string;
  text: string;
  act?: DiscourseAct;
  status: 'pending' | 'running' | 'done' | 'skipped' | 'failed';
};

export type ConversationState = {
  sessionId: string;
  activeTopic: ConversationTopicKind;
  activeGoalId?: string;
  activePlanId?: string;
  activeProjectSlug?: string;
  activeWorkspace?: string;
  activeArtifactRefs: string[];
  activePreview?: { url: string; port?: number; processRef?: string; slug?: string };
  recentOperation?: RecentOperation;
  recentVerification?: RecentOperation;
  pendingQuestion?: string;
  pendingPermission?: { proposalId: string; goalId?: string; planId?: string };
  pendingPlanReview?: { planId: string; goalId?: string; title?: string };
  lastOwnerIntent?: string;
  lastJarvisAction?: string;
  lastDiscourse?: DiscourseAct;
  lastResearchQuery?: string;
  referents: Partial<Record<ReferentSlot, string>>;
  topicStack: TopicFrame[];
  projects: ProjectRecord[];
  offeredOptions: OfferedOption[];
  selectedOption?: OfferedOption;
  constraints: string[];
  remembered: string[];
  pendingChange?: string;
  pendingConditional?: {
    ifKind: 'test' | 'build';
    thenAct: DiscourseAct;
    thenActs?: DiscourseAct[];
    stopOnFail?: boolean;
  };
  queue: QueueItem[];
  queuePaused?: boolean;
  paused?: boolean;
  lastError?: { summary: string; at: number };
  revision: number;
  updatedAt: number;
};

export type DiscourseInterpretation = {
  act: DiscourseAct;
  ordinal?: number;
  ordinals?: number[];
  change?: string;
  constraint?: string;
  researchQuery?: string;
  recommend?: boolean;
  thenAct?: DiscourseAct;
  thenActs?: DiscourseAct[];
  ifKind?: 'test' | 'build';
  queueItems?: string[];
  queueOp?: {
    kind: 'review' | 'start' | 'swap' | 'remove' | 'insert' | 'skip' | 'append' | 'move';
    a?: number;
    b?: number;
    text?: string;
    before?: string;
    after?: string;
  };
  statusFocus?: StatusFocus;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  requiresClarification: boolean;
  clarification?: string;
  source: 'discourse' | 'semantic';
};

export type StatusFocus =
  | 'readiness'
  | 'progress'
  | 'pending'
  | 'failure'
  | 'verification'
  | 'preview'
  | 'inventory'
  | 'preference'
  | 'project'
  | 'recovery'
  | 'recent'
  | 'permission'
  | 'capability'
  | 'summary';

export type ResolvedReferent = {
  slot: ReferentSlot;
  value: string;
  project?: ProjectRecord;
  source: 'active' | 'stack' | 'ordinal' | 'preview' | 'plan';
  ambiguous?: string[];
};

export type ConversationView = {
  project?: string;
  goal?: string;
  current?: string;
  recent?: string;
  next?: string;
  permission?: string;
  remembering: string[];
};

export type ConversationDebugView = {
  intent?: DiscourseAct;
  referent?: string;
  goalId?: string;
  planId?: string;
  projectId?: string;
  capabilityId?: string;
  permissionOutcome?: string;
};

export function emptyConversationState(sessionId: string, now = Date.now()): ConversationState {
  return {
    sessionId,
    activeTopic: 'idle',
    activeArtifactRefs: [],
    referents: {},
    topicStack: [],
    projects: [],
    offeredOptions: [],
    constraints: [],
    remembered: [],
    queue: [],
    revision: 1,
    updatedAt: now,
  };
}

export function isDiscourseAct(value: unknown): value is DiscourseAct {
  return typeof value === 'string' && (DISCOURSE_ACTS as readonly string[]).includes(value);
}

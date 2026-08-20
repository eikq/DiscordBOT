/**
 * Operational visual states for the Command Center.
 * These are observable runtime phases, never hidden chain-of-thought.
 */
export const JARVIS_VISUAL_STATES = [
  'IDLE',
  'LISTENING',
  'UNDERSTANDING',
  'MEMORY_RETRIEVAL',
  'WORKSPACE_SEARCH',
  'WEB_SEARCH',
  'PRIVATE_RESEARCH',
  'FETCHING',
  'COMPARING',
  'PLANNING',
  'WAITING_PERMISSION',
  'EXECUTING',
  'VERIFYING',
  'MODEL_GENERATING',
  'RESPONDING',
  'SPEAKING',
  'REFLECTING',
  'LEARNING',
  'EVOLVING',
  'ERROR',
  'DEGRADED',
] as const;

export type JarvisVisualState = (typeof JARVIS_VISUAL_STATES)[number];

export type OperationProgress = {
  current: number;
  total: number;
  unit?: string;
};

export type JarvisErrorCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PERMISSION_REQUIRED'
  | 'CAPABILITY_DENIED'
  | 'RESEARCH_TIMEOUT'
  | 'MEMORY_CONFLICT'
  | 'PLAN_INVALID'
  | 'STEP_FAILED'
  | 'VERIFICATION_FAILED'
  | 'RESOURCE_PRESSURE'
  | 'LOCAL_ACCEPTANCE_REQUIRED'
  | 'CANCELLED'
  | 'BUDGET_EXCEEDED'
  | 'DEPENDENCY_CYCLE'
  | 'SIMULATION_ONLY';

export type ResourcePriority = 'realtime_voice' | 'owner_task' | 'background_evolution';

export type JarvisBudgets = {
  taskSteps: number;
  researchPages: number;
  researchTimeMs: number;
  retries: number;
  reflectionCount: number;
  nightCycleRuntimeMs: number;
  practiceTasks: number;
  eventBuffer: number;
};

export const DEFAULT_BUDGETS: JarvisBudgets = {
  taskSteps: 24,
  researchPages: 8,
  researchTimeMs: 45_000,
  retries: 2,
  reflectionCount: 8,
  nightCycleRuntimeMs: 8 * 60_000,
  practiceTasks: 6,
  eventBuffer: 200,
};

export type EmitMeta = {
  taskId?: string;
  turnId?: string;
  visualState?: JarvisVisualState;
  progress?: OperationProgress;
  simulated?: boolean;
  errorCode?: JarvisErrorCode;
};

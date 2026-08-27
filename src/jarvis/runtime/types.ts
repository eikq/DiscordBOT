export const AGENT_RUN_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;

export type AgentRunStatus =
  | 'started'
  | 'queued'
  | 'running'
  | 'waiting_for_approval'
  | 'stopping'
  | (typeof AGENT_RUN_TERMINAL_STATUSES)[number]
  | 'unknown';

export type AgentConversationMessage = {
  role: string;
  content: string;
};

export type AgentUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AgentRunInput = {
  input: string;
  sessionId?: string;
  sessionKey?: string;
  instructions?: string;
  conversationHistory?: AgentConversationMessage[];
  previousResponseId?: string;
  model?: string;
};
export type AgentRun = {
  runId: string;
  status: AgentRunStatus;
  sessionId?: string;
  model?: string;
  output?: string;
  error?: string;
  usage?: AgentUsage;
  lastEvent?: string;
  pendingSteer?: string;
};

export type RuntimeCapabilities = {
  platform?: string;
  model?: string;
  authRequired: boolean;
  features: Record<string, unknown>;
  endpoints: Record<string, unknown>;
  raw: Record<string, unknown>;
};

export type ApprovalDecision = 'once' | 'session' | 'always' | 'deny';

export type AgentEvent = {
  type: string;
  runId: string;
  timestamp?: number;
  tool?: string;
  preview?: string;
  duration?: number;
  error?: boolean | string;
  delta?: string;
  output?: string;  choice?: ApprovalDecision;
  choices?: string[];
  raw: Record<string, unknown>;
};

export type WaitForRunOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export interface AgentRuntime {
  getCapabilities(): Promise<RuntimeCapabilities>;
  startRun(input: AgentRunInput): Promise<AgentRun>;
  getRun(runId: string): Promise<AgentRun>;
  streamEvents(runId: string, signal?: AbortSignal): AsyncIterable<AgentEvent>;
  approve(runId: string, decision: ApprovalDecision, resolveAll?: boolean): Promise<void>;
  steer(runId: string, instruction: string): Promise<void>;
  stop(runId: string): Promise<void>;
  waitForRun(runId: string, options?: WaitForRunOptions): Promise<AgentRun>;
}

export function isAgentRunTerminal(status: AgentRunStatus): boolean {
  return AGENT_RUN_TERMINAL_STATUSES.includes(status as (typeof AGENT_RUN_TERMINAL_STATUSES)[number]);
}
/**
 * Persistent operational traces. Observable facts only.
 * Trace != memory. Never store chain-of-thought or hidden reasoning.
 */

export type TraceToolRef = {
  toolName: string;
  status: string;
  summary?: string;
};

export type TraceErrorRef = {
  code?: string;
  message: string;
};

export type JarvisTraceRecord = {
  id: string;
  at: string;
  requestId?: string;
  sessionId?: string;
  turnId?: string;
  taskId?: string;
  route?: string;
  modelProfileId?: string;
  engine?: string;
  memoryRefs?: string[];
  skillRefs?: string[];
  capabilities?: string[];
  sources?: string[];
  toolResults?: TraceToolRef[];
  stepDurationMs?: number;
  totalLatencyMs?: number;
  tokens?: number;
  tokensPerSec?: number;
  retryCount?: number;
  errors?: TraceErrorRef[];
  verification?: string;
  experienceId?: string;
  simulated?: boolean;
  success?: boolean;
  /** User-visible input. Not reasoning. Combining marks must be preserved. */
  inputText?: string;
};

export const FORBIDDEN_TRACE_KEYS = [
  'thoughts',
  'thought',
  'reasoning',
  'chainOfThought',
  'chain_of_thought',
  'cot',
  'hiddenReasoning',
  'hidden_reasoning',
  'systemPrompt',
  'system_prompt',
  'rawPrompt',
] as const;

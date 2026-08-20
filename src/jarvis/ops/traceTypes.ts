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

export type TraceCapabilityRef = {
  id: string;
  status: string;
  risk?: string;
};

export type JarvisTraceRecord = {
  id: string;
  at: string;
  requestId?: string;
  sessionId?: string;
  turnId?: string;
  taskId?: string;
  stepId?: string;
  presentationId?: string;
  route?: string;
  modelProfileId?: string;
  engine?: string;
  memoryRefs?: string[];
  skillRefs?: string[];
  capabilities?: TraceCapabilityRef[];
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
  /** Workload class used for model routing. Observable policy, not hidden reasoning. */
  workload?: string;
  fallbackFrom?: string;
  fallbackReason?: string;
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
  'scratchpad',
  'confirmToken',
  'confirmationToken',
  'token',
  'cookie',
  'cookies',
  'authorization',
  'apiKey',
  'api_key',
  'dotenv',
  'envFile',
  'rvcModel',
  'rvc',
  'voiceSecret',
  'consentToken',
  'rawAudio',
  'datasetPath',
  'wavPath',
] as const;

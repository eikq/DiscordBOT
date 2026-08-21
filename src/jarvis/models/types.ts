export type ModelRuntime = 'ollama' | 'openai-compatible' | 'llama.cpp' | 'lm-studio' | 'vllm' | 'sglang' | 'unknown';

export type ModelModality = 'text' | 'vision' | 'audio' | 'embedding';

export type ModelCapability =
  | 'CONVERSATION'
  | 'THAI'
  | 'STRUCTURED_OUTPUT'
  | 'TOOL_SELECTION'
  | 'CODING'
  | 'LONG_CONTEXT'
  | 'VISION'
  | 'CYBER_SPECIALIST'
  | 'RESEARCH';

export type ModelCertificationState = 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN' | 'NOT_TESTED';

export type ModelProfile = {
  id: string;
  displayName: string;
  family?: string;
  architecture?: string;
  source?: string;
  runtime: ModelRuntime;
  quantization?: string;
  parameterCount?: number;
  contextLimits?: { inputTokens?: number; outputTokens?: number };
  modalities: ModelModality[];
  structuredOutput?: boolean;
  toolUse?: boolean;
  languages?: string[];
  vision?: boolean;
  embedding?: boolean;
  specialization?: string[];
  hardwareRequirements?: {
    ramBytes?: number;
    vramBytes?: number;
    accelerator?: string;
  };
  certificationState?: ModelCertificationState;
};

export type ModelCertification = {
  modelId: string;
  capability: ModelCapability;
  state: ModelCertificationState;
  evaluatedAt?: string;
  benchmarkId?: string;
  evidence: string[];
  detail?: string;
};

export type InferenceHealth = {
  providerId: string;
  available: boolean;
  modelAvailable?: boolean;
  detail?: string;
};

export type InferenceMetrics = {
  promptTokens?: number;
  outputTokens?: number;
  timeToFirstTokenMs?: number;
  promptTokensPerSecond?: number;
  generationTokensPerSecond?: number;
  activeRequests?: number;
  queuedRequests?: number;
};

export type InferenceGenerateRequest = {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
};

export type InferenceGenerateResult = {
  text: string | null;
  metrics?: InferenceMetrics;
};

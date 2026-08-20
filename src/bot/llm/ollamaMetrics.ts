export type LlmTurnMetrics = {
  model?: string;
  promptChars?: number;
  promptTokens?: number;
  outputTokens?: number;
  promptEvalMs?: number;
  generationMs?: number;
  loadMs?: number;
  ttftMs?: number;
  tokensPerSec?: number;
  promptTokensPerSec?: number;
  modelLoaded?: boolean;
  sizeVramBytes?: number;
};

export function nsToMs(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return undefined;
  return numeric / 1e6;
}

export function ollamaMetricsFromChat(payload: Record<string, unknown>, extras: {
  ttftMs?: number;
  promptChars?: number;
} = {}): LlmTurnMetrics {
  const promptEvalMs = nsToMs(payload.prompt_eval_duration);
  const generationMs = nsToMs(payload.eval_duration);
  const loadMs = nsToMs(payload.load_duration);
  const promptTokens = numberOrUndef(payload.prompt_eval_count);
  const outputTokens = numberOrUndef(payload.eval_count);
  const metrics: LlmTurnMetrics = {
    ...(typeof payload.model === 'string' && payload.model.trim() ? { model: payload.model } : {}),
    ...(typeof extras.promptChars === 'number' ? { promptChars: extras.promptChars } : {}),
    ...(typeof extras.ttftMs === 'number' ? { ttftMs: extras.ttftMs } : {}),
    ...(promptTokens !== undefined ? { promptTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(promptEvalMs !== undefined ? { promptEvalMs } : {}),
    ...(generationMs !== undefined ? { generationMs } : {}),
    ...(loadMs !== undefined ? { loadMs } : {}),
  };
  if (outputTokens && generationMs && generationMs > 0) {
    metrics.tokensPerSec = outputTokens / (generationMs / 1000);
  }
  if (promptTokens && promptEvalMs && promptEvalMs > 0) {
    metrics.promptTokensPerSec = promptTokens / (promptEvalMs / 1000);
  }
  return metrics;
}

function numberOrUndef(value: unknown): number | undefined {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

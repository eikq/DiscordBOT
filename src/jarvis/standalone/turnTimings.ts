import type { LlmTurnMetrics } from '../../bot/llm/ollamaMetrics';

/**
 * Observable per-stage timings for one standalone Jarvis turn.
 * Omit a field when that stage did not run or cannot be measured.
 */
export type TurnTimings = {
  captureMs?: number;
  utteranceFinalizeMs?: number;
  sttMs?: number;
  memoryIntentMs?: number;
  memoryRetrievalMs?: number;
  skillActivationMs?: number;
  capabilityRoutingMs?: number;
  capabilityExecutionMs?: number;
  promptConstructionMs?: number;
  llmMs?: number;
  llmTtftMs?: number;
  llmPromptEvalMs?: number;
  llmGenerationMs?: number;
  llmLoadMs?: number;
  presentationMs?: number;
  totalMs: number;
};

export type { LlmTurnMetrics };
export { ollamaMetricsFromChat, nsToMs } from '../../bot/llm/ollamaMetrics';

export function compactTurnTimings(timings: TurnTimings): string {
  const parts: string[] = [];
  const push = (label: string, value?: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    parts.push(`${label} ${Math.round(value)}ms`);
  };
  push('stt', timings.sttMs);
  push('mem', timings.memoryRetrievalMs);
  push('skill', timings.skillActivationMs);
  push('tool', timings.capabilityExecutionMs);
  push('ttft', timings.llmTtftMs);
  push('prefill', timings.llmPromptEvalMs);
  push('gen', timings.llmGenerationMs);
  push('llm', timings.llmMs);
  push('present', timings.presentationMs);
  push('total', timings.totalMs);
  return parts.join(' · ');
}

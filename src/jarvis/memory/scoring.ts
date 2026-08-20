import type { MemoryClass, MemoryStatus } from '../../bot/memory/jarvis/types';

export type MemoryRetrievalScores = {
  lexical: number;
  semantic: number;
  recency: number;
  importance: number;
  active: number;
  classRelevance: number;
  total: number;
};

export function scoreMemoryItem(input: {
  lexicalRank?: number;
  semanticScore?: number;
  lastConfirmed: number;
  now: number;
  importance: number;
  status: MemoryStatus;
  memoryClass?: MemoryClass;
  allowedClasses: MemoryClass[];
}): MemoryRetrievalScores {
  const lexical = input.lexicalRank == null ? 0 : round4(1 / (1 + input.lexicalRank));
  const semantic = clamp01(input.semanticScore ?? 0);
  const ageHours = Math.max(0, (input.now - input.lastConfirmed) / 3_600_000);
  const recency = round4(1 / (1 + ageHours / 24));
  const importance = clamp01(input.importance);
  const active = input.status === 'active' ? 1 : 0;
  const classRelevance = !input.memoryClass || input.allowedClasses.includes(input.memoryClass)
    ? 1
    : 0.15;
  const total = round4(
    0.28 * lexical
    + 0.22 * semantic
    + 0.16 * recency
    + 0.16 * importance
    + 0.10 * active
    + 0.08 * classRelevance,
  );
  return { lexical, semantic, recency, importance, active, classRelevance, total };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

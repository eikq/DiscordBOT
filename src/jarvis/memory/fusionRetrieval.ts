import type { RetrievedMemory } from './retrieval';

export type FusionChannel = 'lexical' | 'semantic' | 'both';

export type FusionHit = {
  canonicalId: string;
  text: string;
  channel: FusionChannel;
  score: number;
  provenance: {
    canonicalStore: 'sqlite';
    index?: 'qdrant';
  };
};

export type FusionResult = {
  items: FusionHit[];
  mode: 'lexical_only' | 'fused';
  canonicalStore: 'sqlite';
  qdrantRole: 'derived_index';
};

export type SemanticHit = {
  canonicalId: string;
  score?: number;
  /** Index snippet only. Canonical text comes from SQLite when available. */
  text?: string;
};

/**
 * Lexical (SQLite/FTS) + optional semantic (Qdrant index) → deterministic fusion.
 * SQLite remains canonical. Semantic hits without a canonical id are dropped.
 */
export function fuseMemoryRetrieval(input: {
  lexical: RetrievedMemory[];
  semantic?: SemanticHit[];
  canonicalById?: Map<string, RetrievedMemory>;
  topK?: number;
}): FusionResult {
  const topK = Math.max(1, Math.min(input.topK ?? 8, 16));
  const lexicalById = new Map(input.lexical.map((item, index) => [item.canonicalId, { item, rank: index }]));
  const semantic = (input.semantic ?? []).filter(item => Boolean(item.canonicalId));
  if (semantic.length === 0) {
    return {
      items: input.lexical.slice(0, topK).map((item, rank) => ({
        canonicalId: item.canonicalId,
        text: item.text,
        channel: 'lexical',
        score: rrf(rank),
        provenance: { canonicalStore: 'sqlite' },
      })),
      mode: 'lexical_only',
      canonicalStore: 'sqlite',
      qdrantRole: 'derived_index',
    };
  }
  const scores = new Map<string, { score: number; channel: FusionChannel; text: string }>();
  for (const [id, { item, rank }] of lexicalById) {
    scores.set(id, { score: rrf(rank), channel: 'lexical', text: item.text });
  }
  semantic.forEach((hit, rank) => {
    const sqlite = lexicalById.get(hit.canonicalId)?.item
      ?? input.canonicalById?.get(hit.canonicalId);
    if (!sqlite) return;
    const current = scores.get(hit.canonicalId);
    const add = rrf(rank);
    if (current) {
      current.score += add;
      current.channel = 'both';
      current.text = sqlite.text;
    } else {
      scores.set(hit.canonicalId, { score: add, channel: 'semantic', text: sqlite.text });
    }
  });
  const items = [...scores.entries()]
    .sort((left, right) => right[1].score - left[1].score)
    .slice(0, topK)
    .map(([canonicalId, value]) => ({
      canonicalId,
      text: value.text,
      channel: value.channel,
      score: value.score,
      provenance: {
        canonicalStore: 'sqlite' as const,
        ...(value.channel !== 'lexical' ? { index: 'qdrant' as const } : {}),
      },
    }));
  return {
    items,
    mode: 'fused',
    canonicalStore: 'sqlite',
    qdrantRole: 'derived_index',
  };
}

function rrf(rank: number, k = 60): number {
  return 1 / (k + rank + 1);
}

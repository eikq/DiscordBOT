import type { ResearchCacheMeta } from './types';

export function researchCacheMeta(input: {
  cachedHits: boolean;
  cachedFetches: boolean;
  providerHit: boolean;
  freshFetch: boolean;
  oldestCacheMs?: number | null;
  nowMs: number;
}): ResearchCacheMeta {
  const cached = input.cachedHits || input.cachedFetches;
  return {
    cached,
    cacheAgeMs: cached && typeof input.oldestCacheMs === 'number'
      ? Math.max(0, input.nowMs - input.oldestCacheMs)
      : null,
    providerHit: input.providerHit,
    freshRetrieval: input.freshFetch,
  };
}

export function cachedEvidenceNote(meta: ResearchCacheMeta): string | null {
  if (!meta.cached || meta.freshRetrieval) return null;
  const age = meta.cacheAgeMs != null ? ` Cache age ${Math.round(meta.cacheAgeMs / 1000)}s.` : '';
  return `Cached evidence; not a fresh retrieval.${age}`.trim();
}

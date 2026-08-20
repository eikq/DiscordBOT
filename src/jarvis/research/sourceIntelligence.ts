import { classifySource } from './sourceClass';
import type { SourceRecency, SourceRecord, SourceType, TrustClass } from './types';

const FRESH_MS = 7 * 24 * 60 * 60_000;
const RECENT_MS = 90 * 24 * 60 * 60_000;

export function trustClassOf(source: Pick<SourceRecord, 'sourceClass' | 'domain'>): TrustClass {
  if (source.sourceClass === 'PRIMARY') return 'PRIMARY';
  if (source.sourceClass === 'OFFICIAL') {
    if (/(^|\.)docs\.|(^|\.)developer\.|newsroom|(^|\.)press\./iu.test(source.domain)) return 'PRIMARY';
    return 'OFFICIAL';
  }
  if (source.sourceClass === 'ACADEMIC') return 'ACADEMIC';
  if (source.sourceClass === 'NEWS' || source.sourceClass === 'REFERENCE') return 'REPUTABLE_SECONDARY';
  if (source.sourceClass === 'COMMUNITY') return 'COMMUNITY';
  return 'UNKNOWN';
}

export function sourceTypeOf(source: Pick<SourceRecord, 'status' | 'contentType'>): SourceType {
  const type = (source.contentType || '').toLowerCase();
  if (type.includes('pdf') || type.includes('document')) return 'document';
  if (source.status === 'listed' && !type) return 'search_hit';
  if (type.includes('html') || type.includes('text') || source.status === 'fetched') return 'webpage';
  return 'unknown';
}

export function recencyOf(publishedAt: string | null | undefined, nowMs: number): SourceRecency {
  if (!publishedAt) return 'unknown';
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return 'unknown';
  const age = nowMs - published;
  if (age < 0) return 'unknown';
  if (age <= FRESH_MS) return 'fresh';
  if (age <= RECENT_MS) return 'recent';
  return 'dated';
}

export function enrichSource(source: SourceRecord, nowMs = Date.now()): SourceRecord {
  const trustClass = trustClassOf(source);
  return {
    ...source,
    sourceClass: source.sourceClass || classifySource(source.canonicalUrl || source.url, source.title),
    trustClass,
    sourceType: source.sourceType ?? sourceTypeOf(source),
    recency: source.recency ?? recencyOf(source.publishedAt, nowMs),
    retrievedAt: source.retrievedAt ?? source.fetchedAt,
    duplicateGroup: source.duplicateGroup ?? null,
    claimsSupported: source.claimsSupported ?? [],
  };
}

export function sourceQualitySummary(sources: SourceRecord[]): string {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const key = source.trustClass || trustClassOf(source);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([key, count]) => `${count} ${key.toLowerCase().replace(/_/g, ' ')}`);
  return parts.length ? parts.join(', ') : 'No classified sources.';
}

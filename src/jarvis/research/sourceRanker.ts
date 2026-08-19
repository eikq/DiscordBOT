import { canonicalizeUrl, domainOf } from './networkPolicy';
import { classRank } from './sourceClass';
import type { SearchHit, SourceRecord } from './types';

export function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const key = canonicalizeUrl(hit.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...hit, url: key });
  }
  return out;
}

export function syndicateGroups(sources: SourceRecord[]): string[][] {
  const byTitle = new Map<string, string[]>();
  for (const source of sources) {
    const key = normalizeTitle(source.title);
    if (key.length < 12) continue;
    const list = byTitle.get(key) ?? [];
    list.push(source.sourceId);
    byTitle.set(key, list);
  }
  return [...byTitle.values()].filter(group => group.length > 1);
}

export function rankSources(sources: SourceRecord[], query: string, officialOnly: boolean, freshness: 'any' | 'latest'): SourceRecord[] {
  const tokens = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const ranked = [...sources].sort((left, right) => {
    const classDelta = classRank(left.sourceClass) - classRank(right.sourceClass);
    if (classDelta !== 0) return classDelta;
    if (freshness === 'latest') {
      const leftPub = left.publishedAt ? Date.parse(left.publishedAt) : 0;
      const rightPub = right.publishedAt ? Date.parse(right.publishedAt) : 0;
      if (rightPub !== leftPub) return rightPub - leftPub;
    }
    return scoreTitle(right.title, tokens) - scoreTitle(left.title, tokens);
  });
  if (!officialOnly) return ranked;
  const preferred = ranked.filter(item => item.sourceClass === 'OFFICIAL' || item.sourceClass === 'PRIMARY' || item.sourceClass === 'ACADEMIC');
  return preferred.length > 0 ? preferred : ranked.slice(0, 2);
}

export function sameRegistrable(left: string, right: string): boolean {
  return domainOf(left) === domainOf(right);
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9ก-๙]+/gu, ' ').trim();
}

function scoreTitle(title: string, tokens: string[]): number {
  const hay = title.toLowerCase();
  return tokens.reduce((sum, token) => sum + (hay.includes(token) ? 1 : 0), 0);
}

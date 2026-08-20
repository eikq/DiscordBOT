import { canonicalizeUrl, domainOf } from './networkPolicy';
import { classRank } from './sourceClass';
import { trustClassOf } from './sourceIntelligence';
import type { DuplicateGroup, SearchHit, SourceRecord } from './types';

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

export function resourceKey(url: string): string {
  try {
    const parsed = new URL(canonicalizeUrl(url));
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return canonicalizeUrl(url);
  }
}

export function snippetFingerprint(text: string | undefined): string {
  return (text || '').toLowerCase().replace(/[^a-z0-9ก-๙]+/gu, ' ').trim().slice(0, 160);
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

export function assignDuplicateGroups(sources: SourceRecord[]): { sources: SourceRecord[]; duplicates: DuplicateGroup[] } {
  const duplicates: DuplicateGroup[] = [];
  const groupOf = new Map<string, string>();

  const pushGroup = (ids: string[], reason: DuplicateGroup['reason']) => {
    const unique = [...new Set(ids)];
    if (unique.length < 2) return;
    const members = unique
      .map(id => sources.find(item => item.sourceId === id))
      .filter((item): item is SourceRecord => Boolean(item));
    const representative = [...members].sort((left, right) => rankSource(left) - rankSource(right))[0];
    if (!representative) return;
    const groupId = `dup_${resourceKey(representative.canonicalUrl || representative.url).replace(/[^a-z0-9]/giu, '').slice(0, 16) || representative.sourceId.slice(-8)}`;
    if (duplicates.some(item => item.groupId === groupId && item.reason === reason)) return;
    duplicates.push({
      groupId,
      representativeSourceId: representative.sourceId,
      memberSourceIds: unique,
      reason,
    });
    for (const id of unique) groupOf.set(id, groupId);
  };

  const byCanonical = new Map<string, string[]>();
  const byResource = new Map<string, string[]>();
  const bySnippet = new Map<string, string[]>();
  for (const source of sources) {
    const canonical = canonicalizeUrl(source.canonicalUrl || source.url);
    byCanonical.set(canonical, [...(byCanonical.get(canonical) ?? []), source.sourceId]);
    const resource = resourceKey(source.canonicalUrl || source.url);
    byResource.set(resource, [...(byResource.get(resource) ?? []), source.sourceId]);
    const snippet = snippetFingerprint(source.title);
    if (snippet.length >= 16) bySnippet.set(snippet, [...(bySnippet.get(snippet) ?? []), source.sourceId]);
  }
  for (const ids of byCanonical.values()) pushGroup(ids, 'canonical_url');
  for (const ids of byResource.values()) pushGroup(ids, 'resource_key');
  for (const ids of syndicateGroups(sources)) pushGroup(ids, 'title');
  for (const ids of bySnippet.values()) pushGroup(ids, 'snippet');

  return {
    sources: sources.map(source => ({
      ...source,
      duplicateGroup: groupOf.get(source.sourceId) ?? source.duplicateGroup ?? null,
    })),
    duplicates,
  };
}

export function representativesForFetch(sources: SourceRecord[], duplicates: DuplicateGroup[], maxFetches: number): SourceRecord[] {
  const represented = new Set(duplicates.map(item => item.representativeSourceId));
  const members = new Set(duplicates.flatMap(item => item.memberSourceIds));
  const preferred = sources.filter(item => represented.has(item.sourceId) || !members.has(item.sourceId));
  const rest = sources.filter(item => !preferred.some(entry => entry.sourceId === item.sourceId));
  return [...preferred, ...rest].slice(0, maxFetches);
}

export function rankSources(sources: SourceRecord[], query: string, officialOnly: boolean, freshness: 'any' | 'latest'): SourceRecord[] {
  const tokens = query.toLowerCase().split(/\s+/u).filter(Boolean);
  const ranked = [...sources].sort((left, right) => {
    const classDelta = rankSource(left) - rankSource(right);
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

function rankSource(source: SourceRecord): number {
  const trust = source.trustClass || trustClassOf(source);
  const trustRank = trust === 'PRIMARY' || trust === 'OFFICIAL'
    ? 0
    : trust === 'ACADEMIC'
      ? 1
      : trust === 'REPUTABLE_SECONDARY'
        ? 2
        : trust === 'COMMUNITY'
          ? 5
          : 4;
  return Math.min(classRank(source.sourceClass), trustRank);
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9ก-๙]+/gu, ' ').trim();
}

function scoreTitle(title: string, tokens: string[]): number {
  const hay = title.toLowerCase();
  return tokens.reduce((sum, token) => sum + (hay.includes(token) ? 1 : 0), 0);
}

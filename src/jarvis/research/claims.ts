import crypto from 'node:crypto';
import type { EvidenceRecord, ResearchClaim, ResearchDisagreement, SourceRecord } from './types';
import { trustClassOf } from './sourceIntelligence';

export function buildClaims(
  evidence: EvidenceRecord[],
  sources: SourceRecord[],
  disagreements: ResearchDisagreement[] = [],
): ResearchClaim[] {
  const bySource = new Map(sources.map(item => [item.sourceId, item]));
  const groups = new Map<string, EvidenceRecord[]>();
  for (const item of evidence) {
    if (!bySource.has(item.sourceId)) continue;
    const key = claimKey(item.claim || item.excerpt);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    if (item.kind === 'UNCERTAIN') continue;
    list.push(item);
    groups.set(key, list);
  }

  const claims: ResearchClaim[] = [];
  for (const [, items] of groups) {
    const sourceIds = unique(items.map(item => item.sourceId)).filter(id => bySource.has(id));
    const text = items[0]?.claim || items[0]?.excerpt || '';
    if (!text || !sourceIds.length) continue;
    const { supporting, conflicting } = splitSupportConflict(sourceIds, disagreements, bySource);
    const classes = supporting.map(id => {
      const source = bySource.get(id);
      return source ? trustClassOf(source) : 'UNKNOWN';
    });
    const uncertainty: string[] = [];
    if (conflicting.length) uncertainty.push('Sources disagree on this claim.');
    if (classes.every(item => item === 'COMMUNITY' || item === 'UNKNOWN')) {
      uncertainty.push('Supported only by community or unclassified sources.');
    }
    const confidence = claimConfidence(classes, conflicting.length > 0);
    const claimId = `clm_${hash(text).slice(0, 12)}`;
    claims.push({
      claimId,
      text,
      supportingSourceIds: supporting,
      conflictingSourceIds: conflicting,
      evidenceIds: unique(items.map(item => item.evidenceId)),
      confidence,
      uncertainty,
    });
  }
  return claims.slice(0, 8);
}

export function attachClaimsToSources(sources: SourceRecord[], claims: ResearchClaim[]): SourceRecord[] {
  return sources.map(source => ({
    ...source,
    claimsSupported: claims
      .filter(claim => claim.supportingSourceIds.includes(source.sourceId))
      .map(claim => claim.claimId),
  }));
}

function splitSupportConflict(
  sourceIds: string[],
  disagreements: ResearchDisagreement[],
  bySource: Map<string, SourceRecord>,
): { supporting: string[]; conflicting: string[] } {
  const related = disagreements.filter(item => item.sides.some(side => sourceIds.includes(side.sourceId)));
  const relatedIds = unique(related.flatMap(item => item.sides.map(side => side.sourceId))).filter(id => bySource.has(id));
  const together = relatedIds.filter(id => sourceIds.includes(id));
  const otherSide = relatedIds.filter(id => !sourceIds.includes(id));
  if (together.length >= 2) {
    const ranked = [...together].sort((left, right) => trustRank(bySource.get(left)) - trustRank(bySource.get(right)));
    const supporting = unique([ranked[0]!, ...sourceIds.filter(id => !together.includes(id))]);
    const conflicting = unique([...ranked.slice(1), ...otherSide]).filter(id => !supporting.includes(id));
    return { supporting, conflicting };
  }
  return {
    supporting: sourceIds.filter(id => !otherSide.includes(id)),
    conflicting: otherSide,
  };
}

function trustRank(source: SourceRecord | undefined): number {
  const trust = source ? trustClassOf(source) : 'UNKNOWN';
  if (trust === 'PRIMARY' || trust === 'OFFICIAL') return 0;
  if (trust === 'ACADEMIC') return 1;
  if (trust === 'REPUTABLE_SECONDARY') return 2;
  if (trust === 'COMMUNITY') return 4;
  return 3;
}

function claimConfidence(classes: string[], conflicting: boolean): number {
  if (conflicting) return 0.34;
  if (classes.some(item => item === 'OFFICIAL' || item === 'PRIMARY' || item === 'ACADEMIC')) return 0.62;
  if (classes.some(item => item === 'REPUTABLE_SECONDARY')) return 0.5;
  return 0.42;
}

function claimKey(text: string): string {
  return text.toLowerCase().replace(/\d[\d,.]*/g, '#').replace(/[^a-z0-9ก-๙#]+/gu, ' ').trim().slice(0, 96);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hash(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

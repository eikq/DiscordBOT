import { sourceQualitySummary, trustClassOf } from './sourceIntelligence';
import type { ResearchResult } from './types';

export type ResearchPresentationView = {
  query: string;
  synthesis: string;
  sources: Array<{
    sourceId: string;
    title: string;
    url: string;
    domain?: string;
    trustClass?: string;
    recency?: string;
    publishedAt?: string | null;
  }>;
  evidence: Array<{ evidenceId: string; claim: string; sourceId: string }>;
  uncertainty: string[];
  disagreements: Array<{ topic: string }>;
  cache?: { cached?: boolean; cacheAgeMs?: number | null; freshRetrieval?: boolean };
  claims?: Array<{
    text: string;
    supportingSourceIds?: string[];
    conflictingSourceIds?: string[];
    confidence?: number;
  }>;
  sourceQuality?: Array<{ sourceId: string; trustClass?: string; recency?: string }>;
  timeline?: Array<{ sourceId: string; publishedAt?: string | null; label: string }>;
  summary: string;
  keyFindings: string[];
  conflictingEvidence: string[];
  limitations: string[];
  recommendedFollowUps: string[];
  qualityLabel: string;
};

export function researchToPresentationView(result: ResearchResult): ResearchPresentationView {
  const sources = result.sources.map(item => ({
    sourceId: item.sourceId,
    title: item.title,
    url: item.url,
    domain: item.domain,
    trustClass: item.trustClass || trustClassOf(item),
    recency: item.recency,
    publishedAt: item.publishedAt,
  }));
  const fromClaims = (result.claims ?? []).slice(0, 4).map(item => item.text).filter(Boolean);
  const keyFindings = fromClaims.length > 0
    ? fromClaims
    : result.evidence.slice(0, 4).map(item => item.claim);
  const conflicting = result.disagreements.map(item => item.sides.map(side => side.claim).join(' | '));
  const limitations = [
    ...result.uncertainty,
    'Web sources are untrusted external data. Citations are not invented.',
  ];
  if (result.cache?.cached && !result.cache.freshRetrieval) {
    limitations.unshift('Cached evidence; not a fresh retrieval.');
  }
  const dated = sources
    .filter(item => item.publishedAt)
    .map(item => ({ sourceId: item.sourceId, publishedAt: item.publishedAt, label: item.title || item.domain || item.sourceId }))
    .sort((left, right) => Date.parse(left.publishedAt || '') - Date.parse(right.publishedAt || ''));
  return {
    query: result.query,
    synthesis: result.synthesis,
    sources,
    evidence: result.evidence.map(item => ({
      evidenceId: item.evidenceId,
      claim: item.claim,
      sourceId: item.sourceId,
    })),
    uncertainty: result.uncertainty,
    disagreements: result.disagreements.map(item => ({ topic: item.topic })),
    cache: result.cache,
    claims: result.claims,
    sourceQuality: sources.map(item => ({
      sourceId: item.sourceId,
      trustClass: item.trustClass,
      recency: item.recency,
    })),
    timeline: dated,
    summary: result.synthesis,
    keyFindings: keyFindings.filter(Boolean),
    conflictingEvidence: conflicting,
    limitations: unique(limitations),
    recommendedFollowUps: result.disagreements.length
      ? ['Ask to compare the conflicting sources.', 'Ask to show a cited source.']
      : ['Ask to show a cited source.', 'Ask to compare two sources if needed.'],
    qualityLabel: sourceQualitySummary(result.sources),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))];
}

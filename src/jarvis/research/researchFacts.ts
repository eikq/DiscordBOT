import type { VerifiedFact } from '../core/types';
import type { ResearchResult } from './types';

export function researchFactsFromResult(result: ResearchResult): VerifiedFact[] {
  const facts: VerifiedFact[] = result.citations.map(citation => ({
    key: `citation.${citation.sourceId}`,
    value: citation.url,
    sourceType: 'tool',
    sourceRef: citation.sourceId,
    confidence: 1,
    immutableForPresentation: true,
  }));
  result.disagreements.forEach((item, index) => {
    facts.push({
      key: `disagreement.${index}`,
      value: item.sides.map(side => side.claim).join(' | '),
      sourceType: 'tool',
      sourceRef: item.sides[0]?.sourceId,
      confidence: 1,
      immutableForPresentation: true,
    });
  });
  return facts;
}

export function isResearchResult(value: unknown): value is ResearchResult {
  return Boolean(value)
    && typeof value === 'object'
    && Array.isArray((value as ResearchResult).sources)
    && Array.isArray((value as ResearchResult).citations);
}

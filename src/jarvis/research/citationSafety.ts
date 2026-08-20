import { classifyResearchUrl } from './networkPolicy';
import type { ResearchCitation, SourceRecord } from './types';

export function sanitizeCitations(sources: SourceRecord[]): ResearchCitation[] {
  const seen = new Set<string>();
  const citations: ResearchCitation[] = [];
  for (const source of sources) {
    const url = source.canonicalUrl || source.url;
    const classified = classifyResearchUrl(url);
    if (!classified.ok) continue;
    if (seen.has(classified.url.href)) continue;
    if (!source.sourceId || !source.domain) continue;
    seen.add(classified.url.href);
    citations.push({
      sourceId: source.sourceId,
      label: `[${citations.length + 1}] ${source.domain}`,
      url: classified.url.href,
      sourceClass: source.sourceClass,
    });
  }
  return citations;
}

export function citationsAreGrounded(citations: ResearchCitation[], sources: SourceRecord[]): boolean {
  const byId = new Map(sources.map(item => [item.sourceId, item]));
  return citations.every(citation => {
    const source = byId.get(citation.sourceId);
    if (!source) return false;
    const classified = classifyResearchUrl(citation.url);
    if (!classified.ok) return false;
    const expected = source.canonicalUrl || source.url;
    return classifyResearchUrl(expected).ok && classified.url.href === (classifyResearchUrl(expected) as { ok: true; url: URL }).url.href;
  });
}

export function rejectInventedCitation(url: string, sources: SourceRecord[]): boolean {
  const classified = classifyResearchUrl(url);
  if (!classified.ok) return true;
  return !sources.some(source => {
    const expected = classifyResearchUrl(source.canonicalUrl || source.url);
    return expected.ok && expected.url.href === classified.url.href;
  });
}

import type { ResearchCitation, SourceRecord } from './types';

export function buildCitations(sources: SourceRecord[]): ResearchCitation[] {
  return sources.map((source, index) => ({
    sourceId: source.sourceId,
    label: `[${index + 1}] ${source.domain}`,
    url: source.canonicalUrl || source.url,
    sourceClass: source.sourceClass,
  }));
}

export function sourceRefs(sources: SourceRecord[]): string[] {
  return sources.map(source => source.sourceId);
}

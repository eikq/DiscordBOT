import { sanitizeCitations } from './citationSafety';
import type { ResearchCitation, SourceRecord } from './types';

export function buildCitations(sources: SourceRecord[]): ResearchCitation[] {
  return sanitizeCitations(sources);
}

export function sourceRefs(sources: SourceRecord[]): string[] {
  return sources.map(source => source.sourceId);
}

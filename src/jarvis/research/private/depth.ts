import { MAX_FETCHES, MAX_RESEARCH_ROUNDS, MAX_SEARCH_QUERIES } from '../constants';
import { planResearch, type ResearchPlan } from '../researchPlanner';
import type { ResearchDepth } from './types';

export function planResearchDepth(
  query: string,
  depth: ResearchDepth = 'standard',
  officialOnly = false,
  freshness: 'any' | 'latest' = 'any',
): ResearchPlan {
  const base = planResearch(query, officialOnly, freshness === 'latest' || depth === 'deep' || depth === 'forensic' ? 'latest' : freshness);
  if (depth === 'none') {
    return {
      ...base,
      queries: [],
      maxFetches: 0,
      maxRounds: 0,
    };
  }
  if (depth === 'quick') {
    return {
      ...base,
      queries: [query],
      maxFetches: Math.min(2, MAX_FETCHES),
      maxRounds: 1,
    };
  }
  if (depth === 'standard') return base;

  const extras = depth === 'forensic'
    ? [
        `${query} official primary source`,
        `${query} independent confirmation`,
        `${query} conflicting evidence`,
        `${query} site:gov OR site:edu`,
        `${query} latest 2026`,
      ]
    : [
        `${query} official source`,
        `${query} independent confirmation`,
        `${query} conflicting evidence`,
      ];

  return {
    ...base,
    queries: unique([query, ...base.queries, ...extras]).slice(0, MAX_SEARCH_QUERIES + (depth === 'forensic' ? 2 : 1)),
    maxFetches: Math.min(MAX_FETCHES + (depth === 'forensic' ? 2 : 1), 8),
    maxRounds: Math.min(MAX_RESEARCH_ROUNDS + 1, 3),
    freshness: 'latest',
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))];
}

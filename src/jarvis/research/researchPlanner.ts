import { MAX_FETCHES, MAX_RESEARCH_ROUNDS, MAX_SEARCH_QUERIES } from './constants';

export type ResearchPlan = {
  queries: string[];
  maxFetches: number;
  maxRounds: number;
  officialOnly: boolean;
  freshness: 'any' | 'latest';
  cancelled?: boolean;
  pageBudget?: number;
};

export function planResearch(query: string, officialOnly: boolean, freshness: 'any' | 'latest'): ResearchPlan {
  const topic = query.trim();
  const queries = [topic];
  if (officialOnly) queries.push(`${topic} official site`);
  if (freshness === 'latest') queries.push(`${topic} latest`, `${topic} 2026`);
  else queries.push(`${topic} documentation`);
  return {
    queries: [...new Set(queries.filter(Boolean))].slice(0, MAX_SEARCH_QUERIES),
    maxFetches: MAX_FETCHES,
    maxRounds: MAX_RESEARCH_ROUNDS,
    officialOnly,
    freshness,
    cancelled: false,
    pageBudget: MAX_FETCHES,
  };
}

export function nextRoundQuery(topic: string, round: number): string | null {
  if (round >= MAX_RESEARCH_ROUNDS) return null;
  if (round === 1) return `${topic} news`;
  return null;
}

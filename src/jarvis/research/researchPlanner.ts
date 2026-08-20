import { MAX_RESEARCH_ROUNDS } from './constants';
import { planStructuredResearch, type StructuredResearchPlan } from './queryPlan';
import type { DepthBudget, PlannedQuery } from './types';

export type ResearchPlan = {
  queries: string[];
  maxFetches: number;
  maxRounds: number;
  officialOnly: boolean;
  freshness: 'any' | 'latest';
  cancelled?: boolean;
  pageBudget?: number;
  queryPlan?: PlannedQuery[];
  budget?: DepthBudget;
  providerLimit?: number;
};

export function toResearchPlan(plan: StructuredResearchPlan): ResearchPlan {
  return {
    queries: plan.queries.map(item => item.text),
    maxFetches: plan.budget.maxFetches,
    maxRounds: plan.budget.maxRounds,
    officialOnly: plan.officialOnly,
    freshness: plan.freshness,
    cancelled: false,
    pageBudget: plan.budget.maxFetches,
    queryPlan: plan.queries,
    budget: plan.budget,
    providerLimit: plan.budget.providerLimit,
  };
}

export function planResearch(query: string, officialOnly: boolean, freshness: 'any' | 'latest'): ResearchPlan {
  return toResearchPlan(planStructuredResearch({
    query,
    depth: 'standard',
    officialOnly,
    freshness,
  }));
}

export function nextRoundQuery(topic: string, round: number, maxRounds = MAX_RESEARCH_ROUNDS): string | null {
  if (round >= maxRounds) return null;
  if (round === 1) return `${topic} news`;
  return null;
}

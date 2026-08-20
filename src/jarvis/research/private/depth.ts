import { planStructuredResearch } from '../queryPlan';
import { toResearchPlan, type ResearchPlan } from '../researchPlanner';
import type { ResearchDepth } from './types';

export function planResearchDepth(
  query: string,
  depth: ResearchDepth = 'standard',
  officialOnly = false,
  freshness: 'any' | 'latest' = 'any',
): ResearchPlan {
  return toResearchPlan(planStructuredResearch({
    query,
    depth,
    officialOnly,
    freshness,
  }));
}

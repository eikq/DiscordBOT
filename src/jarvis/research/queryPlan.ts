import type { DepthBudget, PlannedQuery, QueryKind } from './types';
import type { ResearchDepth } from './private/types';
import { MAX_FETCHES, MAX_RESEARCH_ROUNDS } from './constants';

export type StructuredResearchPlan = {
  objective: string;
  intent: 'none' | 'lookup' | 'current' | 'compare' | 'verify';
  queries: PlannedQuery[];
  budget: DepthBudget;
  officialOnly: boolean;
  freshness: 'any' | 'latest';
};

export const DEPTH_BUDGETS: Record<ResearchDepth, DepthBudget> = {
  none: {
    depth: 'none',
    maxQueries: 0,
    maxFetches: 0,
    maxRounds: 0,
    allowFollowUp: false,
    crossCheck: false,
    contradictionAnalysis: false,
    verification: false,
    providerAccess: false,
    providerLimit: 0,
  },
  quick: {
    depth: 'quick',
    maxQueries: 1,
    maxFetches: Math.min(2, MAX_FETCHES),
    maxRounds: 1,
    allowFollowUp: false,
    crossCheck: false,
    contradictionAnalysis: false,
    verification: false,
    providerAccess: true,
    providerLimit: 1,
  },
  standard: {
    depth: 'standard',
    maxQueries: 3,
    maxFetches: MAX_FETCHES,
    maxRounds: MAX_RESEARCH_ROUNDS,
    allowFollowUp: true,
    crossCheck: false,
    contradictionAnalysis: true,
    verification: false,
    providerAccess: true,
    providerLimit: 2,
  },
  deep: {
    depth: 'deep',
    maxQueries: 5,
    maxFetches: Math.min(MAX_FETCHES + 1, 8),
    maxRounds: Math.min(MAX_RESEARCH_ROUNDS + 1, 3),
    allowFollowUp: true,
    crossCheck: true,
    contradictionAnalysis: true,
    verification: true,
    providerAccess: true,
    providerLimit: 2,
  },
  forensic: {
    depth: 'forensic',
    maxQueries: 6,
    maxFetches: Math.min(MAX_FETCHES + 2, 8),
    maxRounds: Math.min(MAX_RESEARCH_ROUNDS + 1, 3),
    allowFollowUp: true,
    crossCheck: true,
    contradictionAnalysis: true,
    verification: true,
    providerAccess: true,
    providerLimit: 2,
  },
};

export function planStructuredResearch(input: {
  query: string;
  depth?: ResearchDepth;
  officialOnly?: boolean;
  freshness?: 'any' | 'latest';
  compare?: boolean;
}): StructuredResearchPlan {
  const objective = input.query.trim();
  const depth = input.depth ?? 'standard';
  const budget = DEPTH_BUDGETS[depth];
  const officialOnly = Boolean(input.officialOnly);
  const freshness = input.freshness === 'latest' || depth === 'deep' || depth === 'forensic'
    ? 'latest'
    : (input.freshness ?? 'any');
  const intent = depth === 'none'
    ? 'none'
    : input.compare
      ? 'compare'
      : budget.verification
        ? 'verify'
        : freshness === 'latest'
          ? 'current'
          : 'lookup';

  if (!budget.providerAccess || !objective) {
    return { objective, intent: 'none', queries: [], budget, officialOnly, freshness };
  }

  const candidates: PlannedQuery[] = [{ kind: 'primary', text: objective }];
  const alternate = alternateWording(objective);
  if (alternate && budget.maxQueries > 1) candidates.push({ kind: 'alternate', text: alternate });
  const entity = extractEntity(objective);
  if (entity && entity.toLowerCase() !== objective.toLowerCase() && (depth === 'deep' || depth === 'forensic')) {
    candidates.push({ kind: 'entity', text: entity });
  }
  if (freshness === 'latest' || depth === 'deep' || depth === 'forensic') {
    candidates.push({ kind: 'recency', text: `${objective} latest` });
  }
  if (officialOnly) candidates.push({ kind: 'documentation', text: `${objective} official site` });
  else if (depth !== 'quick') candidates.push({ kind: 'documentation', text: `${objective} documentation` });
  if (budget.crossCheck) {
    candidates.push({ kind: 'opposing', text: `${objective} conflicting evidence` });
  }
  if (budget.verification) {
    candidates.push({ kind: 'verification', text: `${objective} independent confirmation` });
  }
  if (depth === 'forensic') {
    candidates.push({ kind: 'verification', text: `${objective} official primary source` });
  }

  return {
    objective,
    intent,
    queries: uniqueQueries(candidates).slice(0, budget.maxQueries),
    budget,
    officialOnly,
    freshness,
  };
}

export function selectSearchProviders<T>(providers: T[], budget: DepthBudget): T[] {
  if (!budget.providerAccess || budget.providerLimit <= 0) return [];
  return providers.slice(0, budget.providerLimit);
}

function alternateWording(query: string): string | null {
  const cleaned = query.replace(/\b(latest|current|today|official|documentation|docs)\b/giu, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.toLowerCase() === query.toLowerCase()) return query.length > 0 ? `what is ${query}` : null;
  return cleaned;
}

function extractEntity(query: string): string | null {
  const quoted = query.match(/[“"]([^”"]{2,80})[”"]/u);
  if (quoted?.[1]) return quoted[1].trim();
  const code = query.match(/\b([A-Z]{2,}[-\s]?\d{2,5}[A-Za-z0-9]*)\b/u);
  if (code?.[1]) return code[1];
  const proper = query.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/u);
  if (proper?.[1] && proper[1].length > 2) return proper[1];
  return null;
}

function uniqueQueries(queries: PlannedQuery[]): PlannedQuery[] {
  const seen = new Set<string>();
  const out: PlannedQuery[] = [];
  for (const item of queries) {
    const key = item.text.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, text: item.text.trim() });
  }
  return out;
}

export function queryKindOrder(): QueryKind[] {
  return ['primary', 'alternate', 'entity', 'recency', 'documentation', 'opposing', 'verification'];
}

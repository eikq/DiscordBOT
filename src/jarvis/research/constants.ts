import { RESEARCH_PRIVATE_BROWSE } from './private/constants';

export { RESEARCH_PRIVATE_BROWSE, isPrivateResearchCapabilityId } from './private/constants';

export const RESEARCH_SEARCH = 'research.search';
export const RESEARCH_FETCH = 'research.fetchSource';
export const RESEARCH_GET = 'research.getSource';
export const RESEARCH_COMPARE = 'research.compareSources';
export const RESEARCH_CURRENT = 'research.current';

export const RESEARCH_CAPABILITY_IDS = [
  RESEARCH_SEARCH,
  RESEARCH_FETCH,
  RESEARCH_GET,
  RESEARCH_COMPARE,
  RESEARCH_CURRENT,
] as const;

export const ALL_RESEARCH_CAPABILITY_IDS = [
  ...RESEARCH_CAPABILITY_IDS,
  RESEARCH_PRIVATE_BROWSE,
] as const;

export const SOURCE_ID_PATTERN = /^src_[a-f0-9]{12}$/u;
export const EVIDENCE_ID_PATTERN = /^evd_[a-f0-9]{12}$/u;
export const SESSION_ID_PATTERN = /^rs_[a-f0-9]{12}$/u;

export const MAX_QUERY_CHARS = 200;
export const MAX_SEARCH_RESULTS = 8;
export const MAX_FETCHES = 6;
export const MAX_SEARCH_QUERIES = 3;
export const MAX_RESEARCH_ROUNDS = 2;
export const MAX_EXCERPT_CHARS = 400;
export const MAX_TITLE_CHARS = 180;
export const MAX_BODY_BYTES = 2_500_000;
export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 12_000;
export const SEARCH_TIMEOUT_MS = 8_000;
export const SEARCH_CACHE_TTL_MS = 5 * 60_000;
export const FETCH_CACHE_TTL_MS = 15 * 60_000;
export const SESSION_RETENTION_MS = 24 * 60 * 60_000;
export const MAX_SESSIONS = 40;

export const RESEARCH_SCHEMA_VERSION = 1;

export function isResearchCapabilityId(id: string): boolean {
  return (RESEARCH_CAPABILITY_IDS as readonly string[]).includes(id);
}

export function isResearchReadCapability(id: string): boolean {
  return isResearchCapabilityId(id);
}

export type SourceClass =
  | 'PRIMARY'
  | 'OFFICIAL'
  | 'ACADEMIC'
  | 'NEWS'
  | 'REFERENCE'
  | 'COMMUNITY'
  | 'UNKNOWN';

export type TrustClass =
  | 'OFFICIAL'
  | 'PRIMARY'
  | 'ACADEMIC'
  | 'REPUTABLE_SECONDARY'
  | 'COMMUNITY'
  | 'UNKNOWN';

export type SourceType = 'webpage' | 'document' | 'search_hit' | 'unknown';
export type SourceRecency = 'fresh' | 'recent' | 'dated' | 'unknown';
export type QueryKind =
  | 'primary'
  | 'alternate'
  | 'entity'
  | 'recency'
  | 'documentation'
  | 'opposing'
  | 'verification';

export type PlannedQuery = {
  kind: QueryKind;
  text: string;
};

export type DepthBudget = {
  depth: 'none' | 'quick' | 'standard' | 'deep' | 'forensic';
  maxQueries: number;
  maxFetches: number;
  maxRounds: number;
  allowFollowUp: boolean;
  crossCheck: boolean;
  contradictionAnalysis: boolean;
  verification: boolean;
  providerAccess: boolean;
  providerLimit: number;
};

export type SourceStatus = 'listed' | 'fetched' | 'unsupported' | 'failed' | 'blocked';

export type TrustSignals = {
  officialDomain: boolean;
  hasPublishedAt: boolean;
  https: boolean;
};

export type SourceRecord = {
  sourceId: string;
  url: string;
  canonicalUrl: string;
  domain: string;
  title: string;
  publishedAt: string | null;
  updatedAt: string | null;
  fetchedAt: string | null;
  retrievedAt?: string | null;
  contentType: string | null;
  provider: string;
  sourceClass: SourceClass;
  trustClass?: TrustClass;
  sourceType?: SourceType;
  recency?: SourceRecency;
  duplicateGroup?: string | null;
  claimsSupported?: string[];
  trustSignals: TrustSignals;
  status: SourceStatus;
  cached: boolean;
};

export type EvidenceKind = 'SOURCE_SUPPORTED' | 'INFERENCE' | 'UNCERTAIN' | 'CONFLICTING';

export type EvidenceRecord = {
  evidenceId: string;
  sourceId: string;
  claim: string;
  excerpt: string;
  location: string | null;
  confidence: number;
  publishedAt: string | null;
  fetchedAt: string | null;
  kind: EvidenceKind;
};

export type ResearchCitation = {
  sourceId: string;
  label: string;
  url: string;
  sourceClass: SourceClass;
};

export type ResearchStageId =
  | 'intent'
  | 'plan'
  | 'search'
  | 'fetch'
  | 'normalize'
  | 'quality'
  | 'compare'
  | 'synthesis'
  | 'verify';
export type ResearchStageState = 'pending' | 'active' | 'done' | 'failed' | 'empty';

export type ResearchStage = {
  id: ResearchStageId;
  label: string;
  detail: string;
  state: ResearchStageState;
};

export type ResearchDisagreement = {
  topic: string;
  sides: Array<{ sourceId: string; claim: string }>;
};

export type ResearchClaim = {
  claimId: string;
  text: string;
  supportingSourceIds: string[];
  conflictingSourceIds: string[];
  evidenceIds: string[];
  confidence: number;
  uncertainty: string[];
};

export type ResearchCacheMeta = {
  cached: boolean;
  cacheAgeMs: number | null;
  providerHit: boolean;
  freshRetrieval: boolean;
};

export type DuplicateGroup = {
  groupId: string;
  representativeSourceId: string;
  memberSourceIds: string[];
  reason: 'canonical_url' | 'resource_key' | 'title' | 'snippet';
};

export type ResearchTraceEvent = {
  stage: ResearchStageId | 'trace';
  state: ResearchStageState;
  detail: string;
};

export type ResearchResult = {
  sessionId: string;
  query: string;
  officialOnly: boolean;
  freshness: 'any' | 'latest';
  sources: SourceRecord[];
  evidence: EvidenceRecord[];
  citations: ResearchCitation[];
  disagreements: ResearchDisagreement[];
  synthesis: string;
  uncertainty: string[];
  stages: ResearchStage[];
  researchedAt: string;
  cached: boolean;
  sourceRefs: string[];
  depth?: 'none' | 'quick' | 'standard' | 'deep' | 'forensic';
  plan?: { queries: PlannedQuery[]; maxQueries: number; maxFetches: number; maxRounds: number };
  cache?: ResearchCacheMeta;
  claims?: ResearchClaim[];
  duplicates?: DuplicateGroup[];
  trace?: ResearchTraceEvent[];
};

export type ResearchSnapshot = {
  attached: boolean;
  healthy: boolean;
  reason?: string;
  last?: ResearchResult;
};

export type SearchHit = {
  url: string;
  title: string;
  snippet?: string;
  provider: string;
  publishedAt?: string | null;
};

export type FetchSuccess = {
  url: string;
  finalUrl: string;
  contentType: string;
  bodyText: string;
  status: number;
};

export type LookupFn = (hostname: string) => Promise<string[]>;

export type ResearchHttpGet = (url: string, init: {
  timeoutMs: number;
  headers: Record<string, string>;
}) => Promise<{
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
  redirectedFrom?: string;
}>;

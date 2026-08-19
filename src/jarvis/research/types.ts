export type SourceClass =
  | 'PRIMARY'
  | 'OFFICIAL'
  | 'ACADEMIC'
  | 'NEWS'
  | 'REFERENCE'
  | 'COMMUNITY'
  | 'UNKNOWN';

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
  contentType: string | null;
  provider: string;
  sourceClass: SourceClass;
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

export type ResearchStageId = 'search' | 'fetch' | 'compare' | 'synthesis';
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

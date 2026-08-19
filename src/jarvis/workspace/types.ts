export type WorkspaceMode = 'read_only';

export type IndexStatus = 'ready' | 'stale' | 'too_large' | 'unsupported' | 'binary' | 'missing' | 'denied';

export type WorkspaceRecord = {
  id: string;
  displayName: string;
  mode: WorkspaceMode;
  root: string;
  include: string[];
  exclude: string[];
};

export type DocumentRecord = {
  documentId: string;
  workspaceId: string;
  relativePath: string;
  displayName: string;
  fileType: string;
  size: number;
  modifiedAt: string;
  contentHash?: string;
  indexStatus: IndexStatus;
  lineCount?: number;
  indexedAt?: string;
  stale?: boolean;
};

export type DocumentChunk = {
  chunkId: string;
  documentId: string;
  workspaceId: string;
  relativePath: string;
  lineStart?: number;
  lineEnd?: number;
  heading?: string;
  body: string;
  modifiedAt?: string;
  contentHash?: string;
};

export type SymbolRecord = {
  documentId: string;
  workspaceId: string;
  relativePath: string;
  name: string;
  kind: 'class' | 'interface' | 'function' | 'constant' | 'type' | 'enum' | 'reference';
  lineStart?: number;
  lineEnd?: number;
};

export type WorkspaceEvidence = {
  evidenceId: string;
  documentId: string;
  workspaceId: string;
  relativePath: string;
  lineStart?: number;
  lineEnd?: number;
  heading?: string;
  excerpt: string;
  modifiedAt?: string;
  indexedAt?: string;
  stale?: boolean;
  kind: 'SOURCE_SUPPORTED' | 'INFERENCE' | 'UNCERTAIN';
};

export type DocumentCitation = {
  documentId: string;
  workspaceId: string;
  label: string;
  relativePath: string;
  lineStart?: number;
  lineEnd?: number;
};

export type WorkspaceStageId = 'search' | 'index' | 'retrieve' | 'compare' | 'synthesis';
export type WorkspaceStageState = 'pending' | 'active' | 'done' | 'failed' | 'empty';

export type WorkspaceStage = {
  id: WorkspaceStageId;
  label: string;
  detail: string;
  state: WorkspaceStageState;
};

export type WorkspaceHit = {
  documentId: string;
  workspaceId: string;
  relativePath: string;
  displayName: string;
  score: number;
  lineStart?: number;
  lineEnd?: number;
  heading?: string;
  excerpt: string;
  reason: 'filename' | 'path' | 'content' | 'symbol';
};

export type WorkspaceResult = {
  sessionId: string;
  workspaceId: string;
  query: string;
  documents: DocumentRecord[];
  hits: WorkspaceHit[];
  evidence: WorkspaceEvidence[];
  citations: DocumentCitation[];
  documentRefs: string[];
  sourceRefs: string[];
  synthesis: string;
  uncertainty: string[];
  stages: WorkspaceStage[];
  comparedAt?: string;
  researchedAt: string;
  cached: boolean;
  stale: boolean;
  hybrid?: boolean;
};

export type WorkspaceSnapshot = {
  attached: boolean;
  healthy: boolean;
  reason?: string;
  workspaceId?: string;
  displayName?: string;
  documentCount?: number;
  changedCount?: number;
  indexStatus?: 'healthy' | 'empty' | 'stale' | 'unavailable';
  last?: WorkspaceResult;
};

export type PathDecision =
  | { ok: true; relativePosix: string; absolute: string }
  | { ok: false; reasonCode: string; userMessage: string };

export type WorkspaceError = Error & { reasonCode?: string };

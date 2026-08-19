export const WORKSPACE_LIST = 'workspace.listWorkspaces';
export const WORKSPACE_LIST_DOCUMENTS = 'workspace.listDocuments';
export const WORKSPACE_SEARCH = 'workspace.search';
export const WORKSPACE_GET = 'workspace.getDocument';
export const WORKSPACE_EXCERPT = 'workspace.getExcerpt';
export const WORKSPACE_SYMBOL = 'workspace.findSymbol';
export const WORKSPACE_COMPARE = 'workspace.compareDocuments';
export const WORKSPACE_META = 'workspace.getMetadata';
export const WORKSPACE_CURRENT = 'workspace.current';
export const WORKSPACE_REFRESH = 'workspace.refreshIndex';

export const WORKSPACE_CAPABILITY_IDS = [
  WORKSPACE_LIST,
  WORKSPACE_LIST_DOCUMENTS,
  WORKSPACE_SEARCH,
  WORKSPACE_GET,
  WORKSPACE_EXCERPT,
  WORKSPACE_SYMBOL,
  WORKSPACE_COMPARE,
  WORKSPACE_META,
  WORKSPACE_CURRENT,
  WORKSPACE_REFRESH,
] as const;

export const DOCUMENT_ID_PATTERN = /^doc_[a-f0-9]{24}$/u;
export const EVIDENCE_ID_PATTERN = /^wev_[a-f0-9]{12}$/u;
export const SESSION_ID_PATTERN = /^ws_[a-f0-9]{12}$/u;

export const WORKSPACE_SCHEMA_VERSION = 1;
export const MAX_QUERY_CHARS = 200;
export const MAX_SEARCH_RESULTS = 12;
export const MAX_LIST_RESULTS = 40;
export const MAX_FILES = 8_000;
export const MAX_BYTES_PER_FILE = 512_000;
export const MAX_TOTAL_INDEXED_BYTES = 48_000_000;
export const MAX_CHUNKS = 40_000;
export const MAX_CHUNK_CHARS = 1_800;
export const MAX_ACTIVE_CHUNKS = 6;
export const MAX_CONTEXT_CHARS = 12_000;
export const MAX_EXCERPT_CHARS = 400;
export const MAX_READ_RETRIES = 2;
export const DEFAULT_WORKSPACE_ID = 'jarvis-project';

export const ALLOWED_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yaml',
  '.yml',
  '.css',
  '.html',
  '.py',
]);

export function isWorkspaceCapabilityId(id: string): boolean {
  return (WORKSPACE_CAPABILITY_IDS as readonly string[]).includes(id);
}

export function isWorkspaceReadCapability(id: string): boolean {
  return isWorkspaceCapabilityId(id);
}

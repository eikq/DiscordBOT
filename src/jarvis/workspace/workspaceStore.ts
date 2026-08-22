import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { jarvisDataRoot } from '../edition/resolve';
import { WORKSPACE_SCHEMA_VERSION } from './constants';
import type { DocumentChunk, DocumentRecord, IndexStatus, SymbolRecord, WorkspaceResult } from './types';

const FORBIDDEN_DB = new Set(['jarvis.db', 'memory.db', 'automation.db', 'research.db']);

export type WorkspaceStore = {
  upsertDocument(doc: StoredDocument): void;
  getDocument(documentId: string): StoredDocument | null;
  getDocumentByPath(workspaceId: string, relativePath: string): StoredDocument | null;
  listDocuments(workspaceId: string): StoredDocument[];
  replaceChunks(documentId: string, chunks: DocumentChunk[]): void;
  replaceSymbols(documentId: string, symbols: SymbolRecord[]): void;
  deleteDocument(documentId: string): void;
  searchFilename(workspaceId: string, query: string, limit: number): StoredDocument[];
  searchContent(workspaceId: string, query: string, limit: number): Array<StoredDocument & { excerpt?: string }>;
  findSymbols(workspaceId: string, name: string, limit: number): SymbolRecord[];
  chunksFor(documentId: string): DocumentChunk[];
  putSession(result: WorkspaceResult): void;
  lastSession(): WorkspaceResult | null;
  documentCount(workspaceId: string): number;
  transaction<T>(fn: () => T): T;
  close(): void;
};

export type StoredDocument = {
  documentId: string;
  workspaceId: string;
  relativePath: string;
  displayName: string;
  fileType: string;
  size: number;
  mtime: number;
  contentHash: string;
  indexedAt: number;
  indexStatus: IndexStatus;
  lineCount: number;
};

export function defaultWorkspaceDbPath(hostRoot = process.cwd()): string {
  return path.join(jarvisDataRoot(hostRoot), 'workspace', 'workspace.db');
}

export function createWorkspaceStore(dbPath: string): WorkspaceStore {
  const resolved = path.resolve(dbPath);
  const base = path.basename(resolved).toLowerCase();
  if (FORBIDDEN_DB.has(base) || path.normalize(resolved).includes(`${path.sep}data${path.sep}brain${path.sep}`)) {
    throw new Error('Workspace store must not reuse canonical memory, brain, reminder, or research databases.');
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved, { enableForeignKeyConstraints: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      document_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      display_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      index_status TEXT NOT NULL,
      line_count INTEGER NOT NULL,
      UNIQUE (workspace_id, relative_path)
    );
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      line_start INTEGER,
      line_end INTEGER,
      heading TEXT,
      body TEXT NOT NULL,
      modified_at TEXT,
      content_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS symbols (
      document_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      line_start INTEGER
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      researched_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      document_id UNINDEXED,
      relative_path,
      display_name,
      body,
      tokenize = 'unicode61'
    );
  `);
  db.prepare('INSERT OR REPLACE INTO workspace_meta(key, value) VALUES (?, ?)').run('schema', String(WORKSPACE_SCHEMA_VERSION));

  return {
    upsertDocument(doc) {
      db.prepare(`
        INSERT OR REPLACE INTO documents(
          document_id, workspace_id, relative_path, display_name, file_type, size, mtime,
          content_hash, indexed_at, index_status, line_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        doc.documentId,
        doc.workspaceId,
        doc.relativePath,
        doc.displayName,
        doc.fileType,
        doc.size,
        doc.mtime,
        doc.contentHash,
        doc.indexedAt,
        doc.indexStatus,
        doc.lineCount,
      );
    },
    getDocument(documentId) {
      return rowToDoc(db.prepare('SELECT * FROM documents WHERE document_id = ?').get(documentId) as Record<string, unknown> | undefined);
    },
    getDocumentByPath(workspaceId, relativePath) {
      return rowToDoc(db.prepare('SELECT * FROM documents WHERE workspace_id = ? AND lower(relative_path) = lower(?)').get(workspaceId, relativePath) as Record<string, unknown> | undefined);
    },
    listDocuments(workspaceId) {
      return (db.prepare('SELECT * FROM documents WHERE workspace_id = ? ORDER BY relative_path').all(workspaceId) as Array<Record<string, unknown>>)
        .map(rowToDoc)
        .filter((item): item is StoredDocument => Boolean(item));
    },
    replaceChunks(documentId, chunks) {
      db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM documents_fts WHERE document_id = ?').run(documentId);
      const insert = db.prepare(`
        INSERT INTO chunks(chunk_id, document_id, workspace_id, relative_path, line_start, line_end, heading, body, modified_at, content_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const fts = db.prepare('INSERT INTO documents_fts(document_id, relative_path, display_name, body) VALUES (?, ?, ?, ?)');
      for (const chunk of chunks) {
        insert.run(
          chunk.chunkId,
          chunk.documentId,
          chunk.workspaceId,
          chunk.relativePath,
          chunk.lineStart ?? null,
          chunk.lineEnd ?? null,
          chunk.heading ?? null,
          chunk.body,
          chunk.modifiedAt ?? null,
          chunk.contentHash ?? null,
        );
        fts.run(chunk.documentId, chunk.relativePath, path.posix.basename(chunk.relativePath), chunk.body);
      }
    },
    replaceSymbols(documentId, symbols) {
      db.prepare('DELETE FROM symbols WHERE document_id = ?').run(documentId);
      const insert = db.prepare('INSERT INTO symbols(document_id, workspace_id, relative_path, name, kind, line_start) VALUES (?, ?, ?, ?, ?, ?)');
      for (const symbol of symbols) {
        insert.run(symbol.documentId, symbol.workspaceId, symbol.relativePath, symbol.name, symbol.kind, symbol.lineStart ?? null);
      }
    },
    deleteDocument(documentId) {
      db.prepare('DELETE FROM chunks WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM documents_fts WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM symbols WHERE document_id = ?').run(documentId);
      db.prepare('DELETE FROM documents WHERE document_id = ?').run(documentId);
    },
    searchFilename(workspaceId, query, limit) {
      const like = `%${escapeLike(query)}%`;
      return (db.prepare(`
        SELECT * FROM documents
        WHERE workspace_id = ? AND (relative_path LIKE ? ESCAPE '\\' OR display_name LIKE ? ESCAPE '\\')
        ORDER BY length(relative_path) ASC
        LIMIT ?
      `).all(workspaceId, like, like, limit) as Array<Record<string, unknown>>)
        .map(rowToDoc)
        .filter((item): item is StoredDocument => Boolean(item));
    },
    searchContent(workspaceId, query, limit) {
      const fts = ftsQuery(query);
      if (!fts) return [];
      try {
        const rows = db.prepare(`
          SELECT d.*, snippet(documents_fts, 3, '', '', '…', 18) AS excerpt
          FROM documents_fts
          JOIN documents d ON d.document_id = documents_fts.document_id
          WHERE d.workspace_id = ? AND documents_fts MATCH ?
          LIMIT ?
        `).all(workspaceId, fts, limit) as Array<Record<string, unknown>>;
        return rows.flatMap(row => {
          const doc = rowToDoc(row);
          return doc ? [{ ...doc, excerpt: String(row.excerpt || '') }] : [];
        });
      } catch {
        const like = `%${escapeLike(query)}%`;
        return (db.prepare(`
          SELECT DISTINCT d.* FROM chunks c
          JOIN documents d ON d.document_id = c.document_id
          WHERE d.workspace_id = ? AND c.body LIKE ? ESCAPE '\\'
          LIMIT ?
        `).all(workspaceId, like, limit) as Array<Record<string, unknown>>)
          .map(rowToDoc)
          .filter((item): item is StoredDocument => Boolean(item));
      }
    },
    findSymbols(workspaceId, name, limit) {
      return (db.prepare(`
        SELECT document_id, workspace_id, relative_path, name, kind, line_start
        FROM symbols
        WHERE workspace_id = ? AND (name = ? OR lower(name) = lower(?))
        ORDER BY CASE WHEN name = ? THEN 0 ELSE 1 END, relative_path
        LIMIT ?
      `).all(workspaceId, name, name, name, limit) as Array<Record<string, unknown>>).flatMap(row => {
        const relativePath = String(row.relative_path || '');
        const documentId = String(row.document_id || '');
        if (!relativePath || !documentId) return [];
        return [{
          documentId,
          workspaceId: String(row.workspace_id || workspaceId),
          relativePath,
          name: String(row.name || ''),
          kind: String(row.kind || 'reference') as SymbolRecord['kind'],
          lineStart: row.line_start == null ? undefined : Number(row.line_start),
        }];
      });
    },
    chunksFor(documentId) {
      return (db.prepare('SELECT * FROM chunks WHERE document_id = ? ORDER BY line_start').all(documentId) as Array<Record<string, unknown>>).map(row => ({
        chunkId: String(row.chunk_id),
        documentId: String(row.document_id),
        workspaceId: String(row.workspace_id),
        relativePath: String(row.relative_path),
        lineStart: row.line_start == null ? undefined : Number(row.line_start),
        lineEnd: row.line_end == null ? undefined : Number(row.line_end),
        heading: row.heading ? String(row.heading) : undefined,
        body: String(row.body),
        modifiedAt: row.modified_at ? String(row.modified_at) : undefined,
        contentHash: row.content_hash ? String(row.content_hash) : undefined,
      }));
    },
    putSession(result) {
      db.prepare('INSERT OR REPLACE INTO sessions(session_id, payload, researched_at) VALUES (?, ?, ?)').run(
        result.sessionId,
        JSON.stringify(result),
        Date.parse(result.researchedAt) || Date.now(),
      );
    },
    lastSession() {
      const row = db.prepare('SELECT payload FROM sessions ORDER BY researched_at DESC LIMIT 1').get() as { payload: string } | undefined;
      return row ? JSON.parse(String(row.payload)) as WorkspaceResult : null;
    },
    documentCount(workspaceId) {
      const row = db.prepare('SELECT COUNT(*) AS n FROM documents WHERE workspace_id = ?').get(workspaceId) as { n: number };
      return Number(row.n || 0);
    },
    transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw error;
      }
    },
    close() {
      db.close();
    },
  };
}

function rowToDoc(row: Record<string, unknown> | undefined): StoredDocument | null {
  if (!row) return null;
  return {
    documentId: String(row.document_id),
    workspaceId: String(row.workspace_id),
    relativePath: String(row.relative_path),
    displayName: String(row.display_name),
    fileType: String(row.file_type),
    size: Number(row.size),
    mtime: Number(row.mtime),
    contentHash: String(row.content_hash),
    indexedAt: Number(row.indexed_at),
    indexStatus: String(row.index_status) as StoredDocument['indexStatus'],
    lineCount: Number(row.line_count),
  };
}

function escapeLike(value: string): string {
  return value.replace(/([%_\\])/gu, '\\$1');
}

function ftsQuery(query: string): string {
  const tokens = query
    .replace(/["']/gu, ' ')
    .split(/\s+/u)
    .map(item => item.trim())
    .filter(item => item.length >= 2 && !/^(and|or|not|near)$/iu.test(item))
    .slice(0, 8);
  return tokens.map(token => `"${token.replace(/"/gu, '')}"`).join(' OR ');
}

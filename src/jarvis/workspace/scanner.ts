import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  MAX_BYTES_PER_FILE,
  MAX_CHUNKS,
  MAX_FILES,
  MAX_READ_RETRIES,
  MAX_TOTAL_INDEXED_BYTES,
} from './constants';
import { chunkDocument, extractSymbols } from './chunker';
import { displayNameOf, documentIdOf, fileTypeOf } from './documentId';
import { decodeUtf8 } from './encoding';
import {
  isAllowedFileType,
  isInsideRoot,
  isSensitiveRelative,
  matchesAny,
  toPosixRelative,
} from './pathPolicy';
import type { StoredDocument, WorkspaceStore } from './workspaceStore';
import type { DocumentChunk, SymbolRecord, WorkspaceRecord } from './types';

export type ScanStats = {
  scanned: number;
  indexed: number;
  unchanged: number;
  deleted: number;
  skipped: number;
  tooLarge: number;
};

export function refreshWorkspaceIndex(
  workspace: WorkspaceRecord,
  store: WorkspaceStore,
  nowMs = Date.now(),
): ScanStats {
  return store.transaction(() => {
  const rootReal = fs.realpathSync.native(workspace.root);
  const seen = new Set<string>();
  const stats: ScanStats = { scanned: 0, indexed: 0, unchanged: 0, deleted: 0, skipped: 0, tooLarge: 0 };
  let totalBytes = 0;
  let totalChunks = 0;

  const walk = (directory: string) => {
    if (stats.scanned >= MAX_FILES || totalBytes >= MAX_TOTAL_INDEXED_BYTES) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (stats.scanned >= MAX_FILES || totalBytes >= MAX_TOTAL_INDEXED_BYTES) return;
      const full = path.join(directory, entry.name);
      const relative = toPosixRelative(path.relative(rootReal, full));
      if (!relative || relative.startsWith('..')) continue;
      if (isSensitiveRelative(relative) || matchesAny(relative, workspace.exclude)) {
        stats.skipped += 1;
        continue;
      }
      if (shouldSkipEntry(entry, full, rootReal)) {
        stats.skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (!couldIncludeDescendant(relative, workspace.include)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      if (!isAllowedFileType(relative) || !matchesAny(relative, workspace.include)) {
        stats.skipped += 1;
        continue;
      }
      stats.scanned += 1;
      const result = indexFile(workspace, store, full, relative, nowMs);
      seen.add(result.documentId);
      if (result.status === 'unchanged') stats.unchanged += 1;
      else if (result.status === 'too_large') stats.tooLarge += 1;
      else if (result.status === 'indexed') {
        stats.indexed += 1;
        totalBytes += result.bytes;
        totalChunks += result.chunks;
        if (totalChunks >= MAX_CHUNKS) return;
      } else {
        stats.skipped += 1;
      }
    }
  };

  walk(rootReal);
  for (const existing of store.listDocuments(workspace.id)) {
    if (!seen.has(existing.documentId)) {
      store.deleteDocument(existing.documentId);
      stats.deleted += 1;
    }
  }
  return stats;
  });
}

function indexFile(
  workspace: WorkspaceRecord,
  store: WorkspaceStore,
  absolute: string,
  relative: string,
  nowMs: number,
): { documentId: string; status: 'indexed' | 'unchanged' | 'too_large' | 'skipped'; bytes: number; chunks: number } {
  const documentId = documentIdOf(workspace.id, relative);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absolute);
  } catch {
    return { documentId, status: 'skipped', bytes: 0, chunks: 0 };
  }
  const existing = store.getDocument(documentId);
  if (existing && existing.mtime === stat.mtimeMs && existing.size === stat.size && existing.indexStatus === 'ready') {
    return { documentId, status: 'unchanged', bytes: 0, chunks: 0 };
  }
  const meta: StoredDocument = {
    documentId,
    workspaceId: workspace.id,
    relativePath: relative,
    displayName: displayNameOf(relative),
    fileType: fileTypeOf(relative),
    size: stat.size,
    mtime: stat.mtimeMs,
    contentHash: '',
    indexedAt: nowMs,
    indexStatus: 'ready',
    lineCount: 0,
  };
  if (stat.size > MAX_BYTES_PER_FILE) {
    store.upsertDocument({ ...meta, indexStatus: 'too_large' });
    store.replaceChunks(documentId, []);
    store.replaceSymbols(documentId, []);
    return { documentId, status: 'too_large', bytes: 0, chunks: 0 };
  }
  const read = readConsistent(absolute, stat);
  if (read.ok === false) {
    store.upsertDocument({ ...meta, indexStatus: read.reason === 'BINARY_REJECTED' ? 'binary' : 'unsupported' });
    store.replaceChunks(documentId, []);
    store.replaceSymbols(documentId, []);
    return { documentId, status: 'skipped', bytes: 0, chunks: 0 };
  }
  const hash = crypto.createHash('sha256').update(read.buffer).digest('hex');
  if (existing?.contentHash === hash && existing.indexStatus === 'ready') {
    store.upsertDocument({ ...existing, mtime: stat.mtimeMs, size: stat.size, indexedAt: nowMs });
    return { documentId, status: 'unchanged', bytes: 0, chunks: 0 };
  }
  const modifiedAt = new Date(stat.mtimeMs).toISOString();
  const chunks = chunkDocument({
    documentId,
    workspaceId: workspace.id,
    relativePath: relative,
    text: read.text,
    modifiedAt,
    contentHash: hash,
  });
  const symbols: SymbolRecord[] = extractSymbols(relative, read.text).map(item => ({
    ...item,
    documentId,
    workspaceId: workspace.id,
    relativePath: relative,
  }));
  store.upsertDocument({
    ...meta,
    contentHash: hash,
    lineCount: read.text.replace(/\r\n/gu, '\n').split('\n').length,
    indexStatus: 'ready',
  });
  store.replaceChunks(documentId, chunks);
  store.replaceSymbols(documentId, symbols);
  return { documentId, status: 'indexed', bytes: stat.size, chunks: chunks.length };
}

function readConsistent(
  absolute: string,
  initial: fs.Stats,
): { ok: true; text: string; buffer: Buffer } | { ok: false; reason: 'BINARY_REJECTED' | 'ENCODING_REJECTED' | 'RACE' } {
  for (let attempt = 0; attempt < MAX_READ_RETRIES; attempt += 1) {
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(absolute);
    } catch {
      return { ok: false, reason: 'RACE' };
    }
    let after: fs.Stats;
    try {
      after = fs.statSync(absolute);
    } catch {
      return { ok: false, reason: 'RACE' };
    }
    if (after.mtimeMs !== initial.mtimeMs || after.size !== initial.size) {
      initial = after;
      continue;
    }
    const decoded = decodeUtf8(buffer);
    if (decoded.ok === false) return { ok: false, reason: decoded.reasonCode };
    return { ok: true, text: decoded.text, buffer };
  }
  return { ok: false, reason: 'RACE' };
}

function shouldSkipEntry(entry: fs.Dirent, full: string, rootReal: string): boolean {
  try {
    if (entry.isSymbolicLink() || isReparse(full)) {
      const real = fs.realpathSync.native(full);
      return !isInsideRoot(rootReal, real);
    }
  } catch {
    return true;
  }
  return false;
}

function isReparse(full: string): boolean {
  try {
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) return true;
    const resolved = path.resolve(full);
    const real = fs.realpathSync.native(full);
    return process.platform === 'win32'
      ? real.toLowerCase() !== resolved.toLowerCase()
      : real !== resolved;
  } catch {
    return false;
  }
}

function couldIncludeDescendant(relativeDir: string, include: string[]): boolean {
  const posix = toPosixRelative(relativeDir);
  return include.some(pattern => {
    if (!pattern.includes('/') && pattern.includes('*')) return false;
    const prefix = pattern.replace(/\*\*.*$/u, '').replace(/\/$/u, '');
    if (!prefix) return true;
    return posix === prefix || posix.startsWith(`${prefix}/`) || prefix.startsWith(`${posix}/`);
  });
}

export function documentToRecord(doc: StoredDocument, stale = false) {
  return {
    documentId: doc.documentId,
    workspaceId: doc.workspaceId,
    relativePath: doc.relativePath,
    displayName: doc.displayName,
    fileType: doc.fileType,
    size: doc.size,
    modifiedAt: new Date(doc.mtime).toISOString(),
    contentHash: doc.contentHash || undefined,
    indexStatus: stale ? 'stale' as const : doc.indexStatus,
    lineCount: doc.lineCount,
    indexedAt: new Date(doc.indexedAt).toISOString(),
    stale,
  };
}

export function isDocumentStale(workspace: WorkspaceRecord, doc: StoredDocument): boolean {
  try {
    const absolute = path.join(workspace.root, ...doc.relativePath.split('/'));
    if (!fs.existsSync(absolute)) return true;
    const stat = fs.statSync(absolute);
    return stat.mtimeMs !== doc.mtime || stat.size !== doc.size;
  } catch {
    return true;
  }
}

import crypto from 'node:crypto';
import path from 'node:path';
import { DOCUMENT_ID_PATTERN } from './constants';
import { toPosixRelative } from './pathPolicy';

export function documentIdOf(workspaceId: string, relativePath: string): string {
  const relativePosix = toPosixRelative(relativePath).toLowerCase();
  const digest = crypto.createHash('sha256').update(`${workspaceId}\0${relativePosix}`).digest('hex').slice(0, 24);
  return `doc_${digest}`;
}

export function isDocumentId(value: string): boolean {
  return DOCUMENT_ID_PATTERN.test(value);
}

export function displayNameOf(relativePath: string): string {
  return path.posix.basename(toPosixRelative(relativePath));
}

export function fileTypeOf(relativePath: string): string {
  const ext = path.posix.extname(toPosixRelative(relativePath)).toLowerCase();
  return ext ? ext.slice(1) : 'unknown';
}

export function newEvidenceId(): string {
  return `wev_${crypto.randomBytes(6).toString('hex')}`;
}

export function newWorkspaceSessionId(): string {
  return `ws_${crypto.randomBytes(6).toString('hex')}`;
}

export function newChunkId(documentId: string, lineStart: number, heading: string): string {
  const digest = crypto.createHash('sha256').update(`${documentId}:${lineStart}:${heading}`).digest('hex').slice(0, 16);
  return `chk_${digest}`;
}

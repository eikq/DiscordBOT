import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_EXTENSIONS } from './constants';
import type { PathDecision, WorkspaceRecord } from './types';

const RESERVED_DEVICES = new Set([
  'con', 'prn', 'aux', 'nul',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

const SENSITIVE_BASENAMES = [
  /^\.env$/iu,
  /^\.env\./iu,
  /^credentials/iu,
  /^credential/iu,
  /^secrets?/iu,
  /^tokens?/iu,
  /^id_rsa$/iu,
  /^id_ed25519$/iu,
  /^jarvis\.db$/iu,
  /^memory\.db$/iu,
  /^automation\.db$/iu,
  /^research\.db$/iu,
  /^workspace\.db$/iu,
  /^voice_consents\.json$/iu,
];

const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.pfx', '.p12', '.p8']);

const SENSITIVE_PREFIXES = [
  '.git/',
  'node_modules/',
  'dist/',
  '.runtime/',
  'data/',
  'data/brain/',
  'data/memory/',
  'data/jarvis/',
  'data/voice',
  '.ssh/',
];

export function toPosixRelative(relative: string): string {
  return relative.replace(/\\/g, '/').replace(/^\/+/u, '');
}

export function classifyUnsafePathInput(raw: string): { reasonCode: string; userMessage: string } | null {
  const value = raw.trim();
  if (!value) return { reasonCode: 'EMPTY_PATH', userMessage: 'No path was provided.' };
  if (value.includes('\0')) return { reasonCode: 'NUL_BYTE', userMessage: 'That path is not allowed.' };
  if (/^(file|javascript|data|vbscript|about|shell):/iu.test(value)) {
    return { reasonCode: 'SCHEME_PATH', userMessage: 'That path is not allowed.' };
  }
  if (/^\\\\/u.test(value) || /^\/\//u.test(value)) {
    return { reasonCode: 'UNC_PATH', userMessage: 'Network paths are not allowed.' };
  }
  if (/^\\\\[.?]\\/u.test(value) || /^\/\/[.?]\//u.test(value)) {
    return { reasonCode: 'DEVICE_PATH', userMessage: 'Device paths are not allowed.' };
  }
  if (/^[a-zA-Z]:/u.test(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    return { reasonCode: 'ABSOLUTE_PATH', userMessage: 'Absolute filesystem paths are not allowed.' };
  }
  if (hasAlternateDataStream(value)) {
    return { reasonCode: 'ADS_PATH', userMessage: 'Alternate data streams are not allowed.' };
  }
  const posix = toPosixRelative(value);
  if (posix.split('/').some(segment => segment === '..' || segment === '.' && posix.includes('..'))) {
    if (posix.split('/').includes('..')) {
      return { reasonCode: 'PATH_TRAVERSAL', userMessage: 'Path traversal is not allowed.' };
    }
  }
  if (posix.split('/').includes('..')) {
    return { reasonCode: 'PATH_TRAVERSAL', userMessage: 'Path traversal is not allowed.' };
  }
  if (posix.split('/').some(segment => RESERVED_DEVICES.has(segment.replace(/\..*$/u, '').toLowerCase()))) {
    return { reasonCode: 'DEVICE_NAME', userMessage: 'Device names are not allowed.' };
  }
  if (looksPercentEncodedTraversal(value)) {
    return { reasonCode: 'PATH_TRAVERSAL', userMessage: 'Path traversal is not allowed.' };
  }
  return null;
}

export function resolveWorkspaceRelative(workspace: WorkspaceRecord, relativePath: string): PathDecision {
  const unsafe = classifyUnsafePathInput(relativePath);
  if (unsafe) return { ok: false, ...unsafe };

  const relativePosix = toPosixRelative(relativePath).replace(/\/+/gu, '/');
  if (!relativePosix || relativePosix === '.') {
    return { ok: false, reasonCode: 'INVALID_RELATIVE', userMessage: 'A document path is required.' };
  }

  const rootReal = realExisting(workspace.root) ?? path.resolve(workspace.root);
  const joined = path.resolve(rootReal, ...relativePosix.split('/'));
  if (!isInsideRoot(rootReal, joined)) {
    return { ok: false, reasonCode: 'OUTSIDE_ROOT', userMessage: 'That file is outside the approved workspace.' };
  }
  if (differentDrive(rootReal, joined)) {
    return { ok: false, reasonCode: 'DRIVE_SWITCH', userMessage: 'Drive switching is not allowed.' };
  }

  let canonical = joined;
  try {
    if (fs.existsSync(joined)) {
      canonical = fs.realpathSync.native(joined);
    }
  } catch {
    return { ok: false, reasonCode: 'REALPATH_FAILED', userMessage: 'That path could not be resolved safely.' };
  }
  if (!isInsideRoot(rootReal, canonical)) {
    return { ok: false, reasonCode: 'SYMLINK_ESCAPE', userMessage: 'That path escapes the approved workspace.' };
  }
  if (isReparseEscape(joined, rootReal)) {
    return { ok: false, reasonCode: 'REPARSE_ESCAPE', userMessage: 'Reparse points that leave the workspace are not allowed.' };
  }

  const fromRoot = toPosixRelative(path.relative(rootReal, canonical));
  if (fromRoot.split('/').includes('..') || path.isAbsolute(fromRoot)) {
    return { ok: false, reasonCode: 'OUTSIDE_ROOT', userMessage: 'That file is outside the approved workspace.' };
  }
  if (isSensitiveRelative(fromRoot)) {
    return { ok: false, reasonCode: 'SENSITIVE_PATH', userMessage: 'That file is excluded.' };
  }
  if (!matchesAny(fromRoot, workspace.include)) {
    return { ok: false, reasonCode: 'NOT_INCLUDED', userMessage: 'That file is not in the workspace include set.' };
  }
  if (matchesAny(fromRoot, workspace.exclude)) {
    return { ok: false, reasonCode: 'EXCLUDED_PATH', userMessage: 'That file is excluded.' };
  }
  return { ok: true, relativePosix: fromRoot, absolute: canonical };
}

export function isAllowedFileType(relativePosix: string): boolean {
  const ext = path.posix.extname(relativePosix).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

export function isSensitiveRelative(relativePosix: string): boolean {
  const posix = toPosixRelative(relativePosix);
  const base = path.posix.basename(posix);
  const ext = path.posix.extname(base).toLowerCase();
  if (SENSITIVE_EXTENSIONS.has(ext)) return true;
  if (SENSITIVE_BASENAMES.some(pattern => pattern.test(base))) return true;
  const lowered = posix.toLowerCase();
  return SENSITIVE_PREFIXES.some(prefix => lowered === prefix.replace(/\/$/u, '') || lowered.startsWith(prefix));
}

export function matchesAny(relativePosix: string, patterns: string[]): boolean {
  return patterns.some(pattern => matchGlob(relativePosix, pattern));
}

export function matchGlob(relativePosix: string, pattern: string): boolean {
  return globToRegExp(pattern).test(toPosixRelative(relativePosix));
}

export function globToRegExp(pattern: string): RegExp {
  const posix = toPosixRelative(pattern);
  let source = '';
  for (let index = 0; index < posix.length; index += 1) {
    if (posix.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 2;
      continue;
    }
    if (posix[index] === '*' && posix[index + 1] === '*') {
      source += '.*';
      index += 1;
      continue;
    }
    if (posix[index] === '*') {
      source += '[^/]*';
      continue;
    }
    if (posix[index] === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(posix[index] ?? '');
  }
  return new RegExp(`^${source}$`, 'iu');
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const rootNorm = normalizeForCompare(root);
  const candidateNorm = normalizeForCompare(candidate);
  if (candidateNorm === rootNorm) return true;
  const relative = path.relative(rootNorm, candidateNorm);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function differentDrive(root: string, candidate: string): boolean {
  if (process.platform !== 'win32') return false;
  const rootDrive = path.parse(path.resolve(root)).root.toLowerCase();
  const candidateDrive = path.parse(path.resolve(candidate)).root.toLowerCase();
  return Boolean(rootDrive) && Boolean(candidateDrive) && rootDrive !== candidateDrive;
}

function hasAlternateDataStream(value: string): boolean {
  if (/^[a-zA-Z]:[\\/]/u.test(value) || /^[a-zA-Z]:$/u.test(value)) {
    return value.slice(2).includes(':');
  }
  return value.includes(':');
}

function looksPercentEncodedTraversal(value: string): boolean {
  if (!/%2e/iu.test(value) && !/%2f/iu.test(value) && !/%5c/iu.test(value)) return false;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.split(/[\\/]/u).includes('..') || classifyUnsafePathInput(decoded) !== null;
  } catch {
    return true;
  }
}

function realExisting(target: string): string | undefined {
  try {
    if (fs.existsSync(target)) return fs.realpathSync.native(target);
  } catch {
    return undefined;
  }
  return undefined;
}

function isReparseEscape(joined: string, rootReal: string): boolean {
  try {
    if (!fs.existsSync(joined)) return false;
    const stat = fs.lstatSync(joined);
    if (!stat.isSymbolicLink() && !isWindowsReparse(joined, stat)) return false;
    const real = fs.realpathSync.native(joined);
    return !isInsideRoot(rootReal, real);
  } catch {
    return true;
  }
}

function isWindowsReparse(full: string, stat: fs.Stats): boolean {
  if (stat.isSymbolicLink()) return true;
  try {
    const resolved = path.resolve(full);
    const real = fs.realpathSync.native(full);
    return normalizeForCompare(real) !== normalizeForCompare(resolved);
  } catch {
    return false;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

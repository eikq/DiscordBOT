import path from 'node:path';
import { HARD_PRIVATE_PATHS, type PolicyResult } from './types';

const SKIP_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'coverage', '.agent']);

export function toPosix(rel: string): string {
  return rel.replace(/\\/g, '/');
}

export function uniqueDenylist(extra: string[] = []): string[] {
  const merged = [...HARD_PRIVATE_PATHS, ...extra]
    .map((item) => item.replace(/\\/g, '/').trim())
    .filter(Boolean);
  return [...new Set(merged)];
}

export function isPrivateRelative(relPosix: string, denylist: string[]): boolean {
  const normalized = relPosix.replace(/^\.\//, '');
  const base = path.posix.basename(normalized);
  for (const rule of denylist) {
    const pattern = rule.replace(/\\/g, '/');
    if (pattern.endsWith('.*') && !pattern.includes('/')) {
      const prefix = pattern.slice(0, -2);
      if (base === prefix || base.startsWith(prefix + '.')) return true;
      continue;
    }
    if (/^\*\.[A-Za-z0-9]+$/u.test(pattern)) {
      const ext = pattern.slice(1).toLowerCase();
      if (base.toLowerCase().endsWith(ext)) return true;
      continue;
    }
    if (pattern.endsWith('*/') || pattern.endsWith('*')) {
      const prefix = pattern.replace(/\*\/?$/, '');
      if (normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix)) return true;
      continue;
    }
    if (pattern.endsWith('/')) {
      if (normalized === pattern.slice(0, -1) || normalized.startsWith(pattern)) return true;
      continue;
    }
    if (normalized === pattern || normalized.startsWith(pattern + '/') || base === pattern) return true;
  }
  return false;
}

export function resolveWorkspacePath(
  workspaceRoot: string,
  requested: string,
  denylist: string[],
  mode: 'read' | 'write',
): PolicyResult<string> {
  const raw = String(requested || '').trim();
  if (!raw) {
    return { ok: false, kind: mode === 'write' ? 'denied_write' : 'denied_read', reason: 'Empty path is not allowed.' };
  }
  if (raw.startsWith('\\\\') || raw.startsWith('//') || raw.includes('\0')) {
    return { ok: false, kind: 'denied_path', reason: 'Rejected path form: ' + raw };
  }
  const resolved = path.resolve(workspaceRoot, raw);
  const rel = path.relative(workspaceRoot, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, kind: 'denied_path', reason: 'Path escapes the workspace: ' + raw };
  }
  const relPosix = toPosix(rel);
  if (isPrivateRelative(relPosix, denylist)) {
    return {
      ok: false,
      kind: mode === 'write' ? 'denied_write' : 'denied_read',
      reason: 'Private path is blocked: ' + relPosix,
    };
  }
  return { ok: true, value: resolved };
}

export function isPathInsideScope(relPosix: string, scope: string[]): boolean {
  if (scope.length === 0) return false;
  const target = relPosix.replace(/^\.\//, '');
  return scope.some((entry) => {
    const prefix = toPosix(entry).replace(/^\.\//, '').replace(/\/$/, '');
    return target === prefix || target.startsWith(prefix + '/');
  });
}

export function shouldSkipWalk(name: string): boolean {
  return SKIP_DIR_NAMES.has(name) || name.startsWith('.venv');
}
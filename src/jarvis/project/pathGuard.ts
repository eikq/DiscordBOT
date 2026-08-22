import fs from 'node:fs';
import path from 'node:path';
import { defaultBuildRoot, sandboxPathFor } from '../build/sandbox';

export class ProjectPathError extends Error {
  public readonly reasonCode: string;

  constructor(reasonCode: string, message: string) {
    super(message);
    this.reasonCode = reasonCode;
  }
}

export function assertProjectSlug(slug: string): string {
  const safe = slug.replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 40);
  if (!safe) throw new ProjectPathError('INVALID_PROJECT_SLUG', 'Project slug is required.');
  if (slug.includes('..') || slug.includes('/') || slug.includes('\\') || path.isAbsolute(slug)) {
    throw new ProjectPathError('PATH_TRAVERSAL_BLOCKED', 'Project slug cannot traverse or use an absolute path.');
  }
  return safe;
}

export function resolveWorkspaceRoot(slug: string, root = defaultBuildRoot()): string {
  return sandboxPathFor(assertProjectSlug(slug), root);
}

export function resolveWorkspaceFile(input: {
  slug: string;
  relativePath?: string;
  root?: string;
}): string {
  const workspace = resolveWorkspaceRoot(input.slug, input.root);
  const relative = (input.relativePath || '').replace(/\\/gu, '/').trim();
  if (!relative || relative === '.') return workspace;
  if (path.isAbsolute(relative) || relative.startsWith('/')) {
    throw new ProjectPathError('ABSOLUTE_PATH_BLOCKED', 'Project files must be relative to the workspace.');
  }
  const parts = relative.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.' || part.includes('\0'))) {
    throw new ProjectPathError('PATH_TRAVERSAL_BLOCKED', 'Project path traversal is not allowed.');
  }
  const resolved = path.resolve(workspace, ...parts);
  const base = path.resolve(workspace);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new ProjectPathError('PATH_TRAVERSAL_BLOCKED', 'Resolved project path escaped the workspace.');
  }
  return resolved;
}

export function assertInsideWorkspace(workspace: string, candidate: string): void {
  const base = path.resolve(workspace);
  const resolved = path.resolve(candidate);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new ProjectPathError('PATH_TRAVERSAL_BLOCKED', 'Path escaped the project workspace.');
  }
}

export function listWorkspaceFiles(slug: string, root = defaultBuildRoot(), max = 80): string[] {
  const workspace = resolveWorkspaceRoot(slug, root);
  if (!fs.existsSync(workspace)) return [];
  const out: string[] = [];
  walk(workspace, workspace, out, max);
  return out;
}

function walk(root: string, current: string, out: string[], max: number): void {
  if (out.length >= max) return;
  const entries = fs.readdirSync(current, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= max) return;
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(current, entry.name);
    const relative = path.relative(root, full).replace(/\\/gu, '/');
    if (entry.isDirectory()) {
      out.push(`${relative}/`);
      walk(root, full, out, max);
    } else {
      out.push(relative);
    }
  }
}

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isPathInsideScope, toPosix } from './paths';
import type { NightTask } from './types';

export type ScopeCheck = {
  changed: string[];
  rejected: string[];
  restored: string[];
};

export type FileSnapshot = Map<string, string>;

function porcelainPath(line: string): string {
  const body = line.slice(3).trim();
  if (body.includes(' -> ')) return toPosix(body.split(' -> ').pop()!.trim());
  return toPosix(body);
}

function fingerprint(workspaceRoot: string, rel: string): string {
  const full = path.join(workspaceRoot, rel);
  if (!fs.existsSync(full)) return '';
  const stat = fs.statSync(full);
  if (stat.isDirectory()) return 'dir:' + rel;
  return String(stat.size) + ':' + fs.readFileSync(full);
}

export function listChangedFiles(workspaceRoot: string): string[] {
  const porcelain = execFileSync('git', ['status', '--porcelain'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  return porcelain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(porcelainPath);
}

export function snapshotChangedFiles(workspaceRoot: string): FileSnapshot {
  const map: FileSnapshot = new Map();
  for (const rel of listChangedFiles(workspaceRoot)) {
    map.set(rel, fingerprint(workspaceRoot, rel));
  }
  return map;
}

export function rejectOutOfScopeChanges(
  workspaceRoot: string,
  task: NightTask,
  before: FileSnapshot = new Map(),
): ScopeCheck {
  const porcelain = execFileSync('git', ['status', '--porcelain'], {
    cwd: workspaceRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  const lines = porcelain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const changed = lines.map(porcelainPath);
  const rejected: string[] = [];
  const restored: string[] = [];
  for (const line of lines) {
    const rel = porcelainPath(line);
    if (isPathInsideScope(rel, task.scope)) continue;
    const now = fingerprint(workspaceRoot, rel);
    if (before.has(rel) && before.get(rel) === now) continue;
    rejected.push(rel);
    if (line.startsWith('??')) {
      const full = path.join(workspaceRoot, rel);
      if (fs.existsSync(full)) {
        const stat = fs.statSync(full);
        if (stat.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
        else fs.unlinkSync(full);
      }
      restored.push(rel);
      continue;
    }
    try {
      execFileSync('git', ['restore', '--source=HEAD', '--worktree', '--staged', '--', rel], {
        cwd: workspaceRoot,
        windowsHide: true,
      });
      restored.push(rel);
    } catch {
      // Leave tracked files in place if restore fails. Never unlink tracked source.
    }
  }
  return { changed, rejected, restored };
}

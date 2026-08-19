import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { nightCliPolicy } from './cliPolicy';

export type WorktreePrepareResult = {
  ok: boolean;
  created: boolean;
  path?: string;
  baseCommit?: string;
  targetClean?: boolean;
  blockers: string[];
  notes: string[];
};

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

export function isolatedWorktreePath(controllerRoot: string, name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '-');
  return path.resolve(path.dirname(controllerRoot), path.basename(controllerRoot) + '-' + safe);
}

export function prepareIsolatedWorktree(input: {
  controllerRoot: string;
  name: string;
  acknowledgeHeadOnly?: boolean;
}): WorktreePrepareResult {
  const notes: string[] = [];
  const blockers: string[] = [];
  const controller = path.resolve(input.controllerRoot);
  const target = isolatedWorktreePath(controller, input.name);
  const porcelain = git(controller, ['status', '--porcelain']);
  const dirty = porcelain.length > 0;
  const baseCommit = git(controller, ['rev-parse', 'HEAD']);
  notes.push('Controller repo: ' + controller + (dirty ? ' (DIRTY — controller only; Night Agent will not write project code here)' : ' (clean)'));
  notes.push('Isolated worktree is based on HEAD ' + baseCommit + ' and does NOT contain uncommitted primary changes.');
  if (dirty && !input.acknowledgeHeadOnly) {
    blockers.push('Primary worktree is dirty. Isolated worktree would be HEAD-only. Re-run with --acknowledge-head-only if tonight\'s NIGHT_SAFE tasks do not need those dirty files. Do not auto-commit the primary repo.');
    return { ok: false, created: false, path: target, baseCommit, blockers, notes };
  }
  if (fs.existsSync(target)) {
    notes.push('Existing worktree left intact (never auto-deleted): ' + target);
    writeCliPolicy(target);
    const targetClean = isMeaningfullyClean(target);
    return {
      ok: targetClean,
      created: false,
      path: target,
      baseCommit,
      targetClean,
      blockers: targetClean ? [] : ['Existing night worktree is dirty. Owner must review it; Night Agent will not reset or clean it.'],
      notes,
    };
  }
  try {
    git(controller, ['worktree', 'add', target, 'HEAD']);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    blockers.push('git worktree add failed: ' + message.split('\n')[0]);
    return { ok: false, created: false, path: target, baseCommit, blockers, notes };
  }
  writeCliPolicy(target);
  const targetClean = isMeaningfullyClean(target);
  notes.push('Created isolated worktree: ' + target);
  return {
    ok: targetClean,
    created: true,
    path: target,
    baseCommit,
    targetClean,
    blockers: targetClean ? [] : ['New night worktree is not clean after create. Owner must review it; Night Agent will not reset or clean it.'],
    notes,
  };
}

function writeCliPolicy(workspace: string): void {
  const dir = path.join(workspace, '.cursor');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cli.json'), JSON.stringify(nightCliPolicy(), null, 2) + '\n', 'utf8');
  ignoreGeneratedCliPolicy(workspace);
}

function ignoreGeneratedCliPolicy(workspace: string): void {
  const gitDir = git(workspace, ['rev-parse', '--absolute-git-dir']);
  const info = path.join(gitDir, 'info');
  fs.mkdirSync(info, { recursive: true });
  const exclude = path.join(info, 'exclude');
  const lines = ['.cursor/', '.cursor/cli.json', '.agent/', '.agent/**'];
  const existing = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  const have = new Set(existing.split(/\r?\n/));
  const extra = lines.filter((line) => !have.has(line));
  if (extra.length) {
    fs.appendFileSync(exclude, (existing && !existing.endsWith('\n') ? '\n' : '') + extra.join('\n') + '\n');
  }
}

function previousNightChangedFiles(workspace: string): Set<string> {
  const statePath = path.join(workspace, '.agent', 'night', 'state.json');
  if (!fs.existsSync(statePath)) return new Set();
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      tasks?: Record<string, { filesChanged?: string[] }>;
    };
    const files = new Set<string>();
    for (const record of Object.values(state.tasks || {})) {
      for (const rel of record.filesChanged || []) {
        files.add(rel.replace(/\\/g, '/'));
      }
    }
    return files;
  } catch {
    return new Set();
  }
}

function isNightBookkeeping(rel: string): boolean {
  return rel === '.cursor' || rel === '.cursor/cli.json' || rel.startsWith('.cursor/')
    || rel === '.agent' || rel.startsWith('.agent/');
}

export function isMeaningfullyClean(workspace: string): boolean {
  let porcelain = '';
  try {
    porcelain = git(workspace, ['status', '--porcelain']);
  } catch {
    return false;
  }
  const previous = previousNightChangedFiles(workspace);
  const files = porcelain.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of files) {
    const rel = line.slice(3).trim().replace(/\\/g, '/').replace(/\/$/, '');
    if (!rel || isNightBookkeeping(rel) || previous.has(rel)) continue;
    if (line.startsWith('??')) return false;
    const diff = git(workspace, ['diff', '--ignore-cr-at-eol', '--', rel]);
    const cached = git(workspace, ['diff', '--cached', '--ignore-cr-at-eol', '--', rel]);
    if (diff || cached) return false;
  }
  return true;
}

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { NightConfig, PolicyResult } from './types';
import { isMeaningfullyClean } from './worktreePrepare';

export type WorkspaceInspection = {
  root: string;
  isGit: boolean;
  dirty: boolean;
  porcelain: string;
  branch?: string;
};

export class NightWorkspace {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  static fromConfig(config: NightConfig, cwd = process.cwd()): NightWorkspace {
    return new NightWorkspace(config.workspaceRoot || cwd);
  }

  inspect(): WorkspaceInspection {
    if (!fs.existsSync(this.root)) {
      throw new Error('Workspace does not exist: ' + this.root);
    }
    const gitDir = path.join(this.root, '.git');
    const isGit = fs.existsSync(gitDir);
    if (!isGit) {
      return { root: this.root, isGit: false, dirty: true, porcelain: 'not a git repository' };
    }
    const porcelain = execFileSync('git', ['status', '--porcelain'], {
      cwd: this.root,
      encoding: 'utf8',
      windowsHide: true,
    });
    let branch: string | undefined;
    try {
      branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: this.root,
        encoding: 'utf8',
        windowsHide: true,
      }).trim();
    } catch {
      branch = undefined;
    }
    return { root: this.root, isGit: true, dirty: !isMeaningfullyClean(this.root), porcelain, branch };
  }

  assertSafeForUnattended(config: NightConfig): PolicyResult<WorkspaceInspection> {
    const info = this.inspect();
    if (!info.isGit) {
      return { ok: false, kind: 'policy', reason: 'Workspace is not a git repository.' };
    }
    if (info.dirty && !config.allowDirtyWorkspace) {
      return {
        ok: false,
        kind: 'policy',
        reason: config.workspaceMode === 'isolated-worktree'
          ? 'Target night worktree is dirty. Review it manually; Night Agent will not reset or clean it.'
          : 'Primary/dirty worktree refused. Use an isolated night worktree (npm run agent:night:prepare -- --create-worktree --name <name>) or wait until this worktree is clean.',
      };
    }
    return { ok: true, value: info };
  }

  relative(absolute: string): string {
    return path.relative(this.root, absolute).replace(/\\/g, '/');
  }
}
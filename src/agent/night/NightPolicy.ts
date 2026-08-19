import path from 'node:path';
import { validateNightCommand } from './commandPolicy';
import { isPathInsideScope, resolveWorkspacePath, toPosix, uniqueDenylist } from './paths';
import type { NightConfig, NightTask, PolicyResult, ValidatedCommand } from './types';

export class NightPolicy {
  readonly denylist: string[];

  constructor(private readonly config: NightConfig) {
    this.denylist = uniqueDenylist(config.privatePathDenylist);
  }

  isNightSafe(task: NightTask): PolicyResult<true> {
    if (!task.nightSafe) return { ok: false, kind: 'policy', reason: 'Task is not marked nightSafe.' };
    if (task.requiresHuman) return { ok: false, kind: 'policy', reason: 'Task requires a human.' };
    if (task.requiresSecrets) return { ok: false, kind: 'policy', reason: 'Tasks that require secrets are denied in v1.' };
    if (task.requiresNetwork && !this.config.allowNetwork) {
      return { ok: false, kind: 'policy', reason: 'Network-dependent tasks are denied.' };
    }
    if (task.risk === 'high') return { ok: false, kind: 'policy', reason: 'High-risk tasks are not NIGHT_SAFE.' };
    return { ok: true, value: true };
  }

  resolveRead(workspaceRoot: string, requested: string): PolicyResult<string> {
    return resolveWorkspacePath(workspaceRoot, requested, this.denylist, 'read');
  }

  resolveWrite(workspaceRoot: string, requested: string, scope: string[]): PolicyResult<string> {
    const resolved = resolveWorkspacePath(workspaceRoot, requested, this.denylist, 'write');
    if (!resolved.ok) return resolved;
    const rel = toPosix(path.relative(workspaceRoot, resolved.value));
    if (!isPathInsideScope(rel, scope)) {
      return { ok: false, kind: 'denied_write', reason: 'Write is outside task scope: ' + rel };
    }
    return resolved;
  }

  validateCommand(raw: string): PolicyResult<ValidatedCommand> {
    return validateNightCommand(raw);
  }

  mayCommit(): boolean {
    return this.config.allowGitCommit && this.config.ownerApprovedGitCommit;
  }
}
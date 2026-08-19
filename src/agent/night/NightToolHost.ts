import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { NightPolicy } from './NightPolicy';
import { isPrivateRelative, shouldSkipWalk } from './paths';
import { isDenied, type NightTask, type SafetyEvent, type ValidatedCommand } from './types';
import { NightWorkspace } from './NightWorkspace';

const execFileAsync = promisify(execFile);

export type ToolCallResult = {
  content: string;
  denied?: boolean;
  finished?: boolean;
  summary?: string;
};

export type CommandRunner = (command: ValidatedCommand, cwd: string) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export const NIGHT_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_dir',
      description: 'List a workspace directory. Paths must stay inside the task scope.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read a workspace text file. Private paths are blocked.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'number' },
          limit: { type: 'number' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_files',
      description: 'Search file contents under a relative path.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string' },
          glob: { type: 'string' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Create or replace a file inside the task scope.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' }, contents: { type: 'string' } },
        required: ['path', 'contents'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'apply_patch',
      description: 'Replace one exact string in a scoped file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string' },
          new_string: { type: 'string' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description: 'Run one allowlisted test/lint/typecheck/build/git inspect command. Arbitrary shell is denied.',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_status',
      description: 'Show git status --short for the workspace.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'git_diff',
      description: 'Show git diff, optionally for one scoped path.',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finish',
      description: 'End this attempt. Acceptance tests, not this call, decide PASS.',
      parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
    },
  },
];

export class NightToolHost {
  readonly changedFiles = new Map<string, { before: string | null; after: string }>();
  private diffBytes = 0;

  constructor(
    private readonly workspace: NightWorkspace,
    private readonly policy: NightPolicy,
    private readonly task: NightTask,
    private readonly onSafety: (event: Omit<SafetyEvent, 'at'>) => void,
    private readonly runCommandImpl: CommandRunner = defaultCommandRunner,
  ) {}

  filesChanged(): string[] {
    return [...this.changedFiles.keys()];
  }

  async execute(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    switch (name) {
      case 'list_dir':
        return this.listDir(String(args.path || '.'));
      case 'read_file':
        return this.readFile(String(args.path || ''), Number(args.offset) || 0, Number(args.limit) || 400);
      case 'search_files':
        return this.searchFiles(String(args.pattern || ''), String(args.path || '.'), String(args.glob || ''));
      case 'write_file':
        return this.writeFile(String(args.path || ''), String(args.contents ?? ''));
      case 'apply_patch':
        return this.applyPatch(String(args.path || ''), String(args.old_string ?? ''), String(args.new_string ?? ''));
      case 'run_command':
        return this.runCommand(String(args.command || ''));
      case 'git_status':
        return this.runCommand('git status --short');
      case 'git_diff':
        return this.runCommand(args.path ? 'git diff -- ' + String(args.path) : 'git diff --stat');
      case 'finish':
        return { content: 'finish recorded', finished: true, summary: String(args.summary || '') };
      default:
        this.note('denied_command', 'Unknown tool: ' + name);
        return { content: 'Unknown tool: ' + name, denied: true };
    }
  }

  private listDir(requested: string): ToolCallResult {
    const resolved = this.policy.resolveRead(this.workspace.root, requested);
    if (isDenied(resolved)) return this.deny(resolved.kind, resolved.reason);
    if (!fs.existsSync(resolved.value) || !fs.statSync(resolved.value).isDirectory()) {
      return { content: 'Not a directory: ' + requested };
    }
    const names = fs.readdirSync(resolved.value)
      .filter((name) => !shouldSkipWalk(name))
      .filter((name) => {
        const rel = this.workspace.relative(path.join(resolved.value, name));
        return !isPrivateRelative(rel, this.policy.denylist);
      })
      .slice(0, 200);
    return { content: names.join('\n') || '(empty)' };
  }

  private readFile(requested: string, offset: number, limit: number): ToolCallResult {
    const resolved = this.policy.resolveRead(this.workspace.root, requested);
    if (isDenied(resolved)) return this.deny(resolved.kind, resolved.reason);
    if (!fs.existsSync(resolved.value) || !fs.statSync(resolved.value).isFile()) {
      return { content: 'File not found: ' + requested };
    }
    const text = fs.readFileSync(resolved.value, 'utf8');
    if (text.length > 256_000) return this.deny('denied_read', 'File exceeds the 256KB read cap: ' + requested);
    const lines = text.split(/\r?\n/);
    const start = Math.max(0, offset);
    const slice = lines.slice(start, start + Math.min(2000, Math.max(1, limit)));
    return { content: slice.map((line, index) => String(start + index + 1).padStart(4, ' ') + '| ' + line).join('\n') };
  }

  private searchFiles(pattern: string, requested: string, glob: string): ToolCallResult {
    if (!pattern) return this.deny('denied_read', 'Search pattern is required.');
    const resolved = this.policy.resolveRead(this.workspace.root, requested || '.');
    if (isDenied(resolved)) return this.deny(resolved.kind, resolved.reason);
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'i');
    } catch {
      return this.deny('denied_read', 'Invalid search regex.');
    }
    const hits: string[] = [];
    const walk = (dir: string) => {
      if (hits.length >= 50) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (hits.length >= 50) break;
        if (shouldSkipWalk(entry.name)) continue;
        const full = path.join(dir, entry.name);
        const rel = this.workspace.relative(full);
        if (isPrivateRelative(rel, this.policy.denylist)) continue;
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (glob && !entry.name.includes(glob.replace('*', ''))) continue;
        if (!/\.(ts|tsx|js|mjs|cjs|md|json)$/.test(entry.name)) continue;
        let text = '';
        try {
          text = fs.readFileSync(full, 'utf8');
        } catch {
          continue;
        }
        const lines = text.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (hits.length < 50 && regex.test(line)) hits.push(rel + ':' + (index + 1) + ':' + line.slice(0, 200));
        });
      }
    };
    walk(resolved.value);
    return { content: hits.join('\n') || 'No matches.' };
  }

  private writeFile(requested: string, contents: string): ToolCallResult {
    const resolved = this.policy.resolveWrite(this.workspace.root, requested, this.task.scope);
    if (isDenied(resolved)) return this.deny(resolved.kind, resolved.reason);
    if (contents.length > 64_000) return this.deny('denied_write', 'write_file exceeds the 64KB cap.');
    const rel = this.workspace.relative(resolved.value);
    if (this.changedFiles.size >= this.task.maxFilesChanged && !this.changedFiles.has(rel)) {
      return this.deny('denied_write', 'maxFilesChanged exceeded (' + this.task.maxFilesChanged + ').');
    }
    const before = fs.existsSync(resolved.value) ? fs.readFileSync(resolved.value, 'utf8') : null;
    const nextBytes = Math.abs(contents.length - (before?.length || 0));
    if (this.diffBytes + nextBytes > this.task.maxDiffBytes) {
      return this.deny('denied_write', 'maxDiffBytes exceeded.');
    }
    fs.mkdirSync(path.dirname(resolved.value), { recursive: true });
    fs.writeFileSync(resolved.value, contents, 'utf8');
    this.changedFiles.set(rel, { before, after: contents });
    this.diffBytes += nextBytes;
    return { content: 'Wrote ' + rel + ' (' + contents.length + ' bytes).' };
  }

  private applyPatch(requested: string, oldString: string, newString: string): ToolCallResult {
    const resolved = this.policy.resolveWrite(this.workspace.root, requested, this.task.scope);
    if (isDenied(resolved)) return this.deny(resolved.kind, resolved.reason);
    if (!fs.existsSync(resolved.value)) return this.deny('denied_write', 'Cannot patch missing file: ' + requested);
    const before = fs.readFileSync(resolved.value, 'utf8');
    const count = before.split(oldString).length - 1;
    if (!oldString || count !== 1) {
      return { content: 'apply_patch needs exactly one old_string match (found ' + count + ').', denied: true };
    }
    return this.writeFile(requested, before.replace(oldString, newString));
  }

  private async runCommand(raw: string): Promise<ToolCallResult> {
    const validated = this.policy.validateCommand(raw);
    if (isDenied(validated)) return this.deny(validated.kind, validated.reason);
    const result = await this.runCommandImpl(validated.value, this.workspace.root);
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, 8000);
    return { content: 'exit ' + result.exitCode + '\n' + output };
  }

  private deny(kind: SafetyEvent['kind'], reason: string): ToolCallResult {
    this.note(kind, reason);
    return { content: 'DENIED: ' + reason, denied: true };
  }

  private note(kind: SafetyEvent['kind'], detail: string): void {
    this.onSafety({ kind, detail, taskId: this.task.id });
  }
}

export async function defaultCommandRunner(command: ValidatedCommand, cwd: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  try {
    const result = await execFileAsync(command.executable, command.args, {
      cwd,
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
      maxBuffer: 2_000_000,
    });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message || String(error),
    };
  }
}

export function nightToolPrompt(): string {
  return [
    'You are a bounded coding worker, not the orchestrator.',
    'Request only these tools: list_dir, read_file, search_files, write_file, apply_patch, run_command, git_status, git_diff, finish.',
    'Never access .env, .runtime, voice/memory databases, or paths outside the task scope.',
    'Never request git push, git reset, git clean, installs, Discord, CCTV, or arbitrary shell.',
    'Acceptance tests decide PASS. Call finish with a short summary when you believe the work is done.',
  ].join('\n');
}
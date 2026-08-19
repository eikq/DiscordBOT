import { spawn } from 'node:child_process';
import type { NightConfig, ProviderFailureCode } from '../night/types';
import { buildCursorAgentArgv, buildCursorTaskPrompt, UNRESOLVED_CURSOR_MODEL } from './cursorArgv';
import { classifyCursorCliText, findAgentExecutable, resolveCursorLaunch } from './cursorPreflight';
import type { CodingAttemptInput, CodingAttemptResult, CodingWorker } from './types';

export type CursorProcessRunner = (input: {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}) => Promise<{ code: number; stdout: string; stderr: string }>;

export class CursorCliCodingAgent implements CodingWorker {
  readonly id: string;
  readonly kind = 'cursor-cli' as const;
  spawnCount = 0;

  constructor(
    private readonly config: NightConfig,
    private readonly modelId: string | undefined,
    private readonly options: {
      executable?: string;
      runner?: CursorProcessRunner;
      useForce?: boolean;
    } = {},
    id = 'cursor-grok',
  ) {
    this.id = id;
  }

  resetContext(): void {
    // Fresh process per attempt; no --resume / --continue.
  }

  async attempt(input: CodingAttemptInput): Promise<CodingAttemptResult> {
    this.resetContext();
    const model = (this.modelId || this.config.cursorModel || '').trim();
    if (this.config.workspaceMode === 'isolated-worktree' && !this.config.workspaceRoot) {
      return fail(this.id, 'provider_error', 'isolated-worktree mode requires workspaceRoot.');
    }
    const executable = this.options.executable || findAgentExecutable();
    if (!executable) {
      return fail(this.id, 'provider_error', 'Cursor CLI agent executable is missing.');
    }
    if (!model || model === UNRESOLVED_CURSOR_MODEL || model.toLowerCase() === 'auto') {
      return fail(this.id, 'model_unavailable', 'Cursor CLI model id is unresolved. Run agent models and set the exact id.');
    }
    const prompt = buildCursorTaskPrompt({
      taskId: input.task.id,
      title: input.task.title,
      goal: input.task.goal,
      scope: input.task.scope,
      acceptance: input.task.acceptanceCommands,
      previousErrors: input.previousErrors,
      projectNotes: input.contextPacket,
    });
    const args = buildCursorAgentArgv({
      model,
      workspace: this.config.workspaceRoot || process.cwd(),
      prompt,
      useForce: this.options.useForce === true && this.config.workspaceMode === 'isolated-worktree',
    });
    this.spawnCount += 1;
    const runner = this.options.runner || defaultCursorRunner;
    const result = await runner({
      executable,
      args,
      cwd: this.config.workspaceRoot || process.cwd(),
      timeoutMs: Math.max(60_000, input.task.maxMinutes * 60_000),
    });
    const combined = [result.stdout, result.stderr].join('\n');
    const classified = classifyCursorCliText(combined);
    if (classified === 'quota_exhausted' || classified === 'auth_error' || classified === 'model_unavailable') {
      return fail(this.id, classified, combined.slice(0, 800) || classified);
    }
    if (/not recognized|enoent|executable missing/i.test(combined) || /einval/i.test(result.stderr)) {
      return fail(this.id, 'provider_error', combined.slice(0, 800));
    }
    return {
      workerId: this.id,
      providerKind: this.kind,
      summary: combined.slice(0, 1000) || 'cursor-cli attempt completed',
      toolCalls: 0,
      contextReset: true,
    };
  }
}

/** @deprecated Use CursorCliCodingAgent. */
export class CursorGrokCodingAgent extends CursorCliCodingAgent {}

export function classifyCursorFailure(text: string): ProviderFailureCode | undefined {
  return classifyCursorCliText(text);
}

function fail(id: string, code: ProviderFailureCode, message: string): CodingAttemptResult {
  return {
    workerId: id,
    providerKind: 'cursor-cli',
    summary: message,
    toolCalls: 0,
    contextReset: true,
    providerFailure: { code, message },
  };
}

async function defaultCursorRunner(input: {
  executable: string;
  args: string[];
  cwd: string;
  timeoutMs?: number;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const launch = resolveCursorLaunch(input.executable);
  return new Promise((resolve) => {
    const child = spawn(launch.command, [...launch.prefixArgs, ...input.args], {
      cwd: input.cwd,
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number, extra = '') => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr: extra ? stderr + '\n' + extra : stderr });
    };
    const timer = input.timeoutMs
      ? setTimeout(() => {
        child.kill('SIGTERM');
        finish(1, 'Cursor CLI timed out after ' + input.timeoutMs + 'ms');
      }, input.timeoutMs)
      : undefined;
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      finish(1, error.message);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      finish(code ?? 1);
    });
  });
}

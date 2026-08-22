import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_INSTALL_MODES, isRegisteredProjectScript, type ProjectInstallMode } from './constants';
import { ProjectPathError, assertInsideWorkspace } from './pathGuard';
import type { ProjectCommandEvidence, ProjectCommandKind, ProjectCommandRequest, ProjectCommandRunner } from './types';

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 4_000;

export function createProjectCommandRunner(options: { now?: () => number } = {}): ProjectCommandRunner {
  const now = options.now ?? (() => Date.now());
  return {
    async run(request) {
      return runTypedCommand(request, now);
    },
  };
}

export function createFakeCommandRunner(
  handler: (request: ProjectCommandRequest) => Partial<ProjectCommandEvidence> = () => ({ exitCode: 0 }),
): ProjectCommandRunner {
  return {
    async run(request) {
      const started = Date.now();
      const overlay = handler(request);
      const exitCode = overlay.exitCode ?? 0;
      return {
        commandType: request.kind,
        argv: typedArgv(request),
        workspace: request.workspace,
        exitCode,
        durationMs: overlay.durationMs ?? Math.max(1, Date.now() - started),
        stdoutSummary: overlay.stdoutSummary ?? (exitCode === 0 ? 'ok' : ''),
        stderrSummary: overlay.stderrSummary ?? '',
        passed: exitCode === 0,
        skipped: overlay.skipped,
        skipReason: overlay.skipReason,
      };
    },
  };
}

export function skipLiveCommandsInTests(): boolean {
  return Boolean(process.env.NODE_TEST_CONTEXT) && process.env.JARVIS_LIVE_NPM !== '1';
}

async function runTypedCommand(request: ProjectCommandRequest, now: () => number): Promise<ProjectCommandEvidence> {
  assertInsideWorkspace(request.workspace, request.workspace);
  const argv = typedArgv(request);
  const started = now();
  const result = await spawnCaptured({
    argv,
    cwd: request.workspace,
    timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    env: request.env,
  });
  return {
    commandType: request.kind,
    argv,
    workspace: request.workspace,
    exitCode: result.exitCode,
    durationMs: Math.max(1, now() - started),
    stdoutSummary: summarizeOutput(result.stdout),
    stderrSummary: summarizeOutput(result.stderr),
    passed: result.exitCode === 0,
  };
}

export function typedArgv(request: ProjectCommandRequest): string[] {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (request.kind === 'npm-install' || request.kind === 'npm-ci') {
    const mode: ProjectInstallMode = request.kind === 'npm-ci' ? 'ci' : 'install';
    if (!ALLOWED_INSTALL_MODES.includes(mode)) {
      throw new ProjectPathError('INSTALL_MODE_BLOCKED', 'Only npm install or npm ci are allowed.');
    }
    if (request.extraArgs?.length) {
      throw new ProjectPathError('ARBITRARY_SHELL_REJECTED', 'Package install does not accept extra arguments.');
    }
    return [npm, mode];
  }
  if (request.kind === 'npm-run') {
    const script = request.script || '';
    if (!isRegisteredProjectScript(script)) {
      throw new ProjectPathError('UNREGISTERED_SCRIPT', 'Only registered package.json scripts can run.');
    }
    const extra = request.extraArgs || [];
    if (extra.some(arg => looksLikeShellMetachar(arg))) {
      throw new ProjectPathError('ARBITRARY_SHELL_REJECTED', 'Script extra arguments cannot contain a shell.');
    }
    return extra.length ? [npm, 'run', script, '--', ...extra] : [npm, 'run', script];
  }
  if (request.kind === 'node-test') {
    const relative = request.script || 'tests/smoke.test.mjs';
    if (path.isAbsolute(relative) || relative.includes('..') || looksLikeShellMetachar(relative)) {
      throw new ProjectPathError('ARBITRARY_SHELL_REJECTED', 'Node test runner only accepts a workspace-relative test file.');
    }
    return [process.execPath, relative];
  }
  throw new ProjectPathError('ARBITRARY_SHELL_REJECTED', 'That command type is not a typed project operation.');
}

export function registeredScriptsOf(workspace: string): string[] {
  const file = path.join(workspace, 'package.json');
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { scripts?: Record<string, unknown> };
    return Object.keys(parsed.scripts || {});
  } catch {
    return [];
  }
}

export function assertScriptRegistered(workspace: string, script: string): void {
  if (!isRegisteredProjectScript(script)) {
    throw new ProjectPathError('UNREGISTERED_SCRIPT', 'Only build, test, lint, dev, or preview scripts are allowed.');
  }
  const registered = registeredScriptsOf(workspace);
  if (!registered.includes(script)) {
    throw new ProjectPathError('UNREGISTERED_SCRIPT', `${script} is not declared in package.json.`);
  }
}

export function looksLikeShellMetachar(value: string): boolean {
  return /[;&|`$<>]|\n|\r|&&|\|\||\bshell\b|\bpowershell\b|\bcmd\.exe\b|\bnpm\s+exec\b|\bcurl\b/iu.test(value);
}

function spawnCaptured(input: {
  argv: string[];
  cwd: string;
  timeoutMs: number;
  env?: Record<string, string>;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = input.argv;
    if (!bin) {
      reject(new ProjectPathError('ARBITRARY_SHELL_REJECTED', 'Typed command is missing.'));
      return;
    }
    const child = spawn(bin, args, {
      cwd: input.cwd,
      env: childEnv(input.env),
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => { stdout = appendLimited(stdout, String(chunk)); });
    child.stderr?.on('data', chunk => { stderr = appendLimited(stderr, String(chunk)); });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ exitCode: null, stdout, stderr: appendLimited(stderr, 'timed out') });
    }, input.timeoutMs);
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}

function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    windir: process.env.windir,
    PATHEXT: process.env.PATHEXT,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };
  if (extra) Object.assign(env, extra);
  return env;
}

function appendLimited(current: string, next: string): string {
  return `${current}${next}`.slice(-OUTPUT_LIMIT);
}

export function summarizeOutput(text: string, max = 400): string {
  return text.replace(/\s+/gu, ' ').trim().slice(0, max);
}

export function evidencePassed(evidence: Pick<ProjectCommandEvidence, 'exitCode' | 'skipped'>): boolean {
  return evidence.skipped !== true && evidence.exitCode === 0;
}

export function commandKindForInstall(mode: ProjectInstallMode): ProjectCommandKind {
  return mode === 'ci' ? 'npm-ci' : 'npm-install';
}

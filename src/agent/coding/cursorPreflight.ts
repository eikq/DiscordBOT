import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { UNRESOLVED_CURSOR_MODEL } from './cursorArgv';
import type { ProviderFailureCode } from '../night/types';

export type CursorPreflight = {
  ok: boolean;
  executable?: string;
  version?: string;
  authenticated?: boolean;
  modelId?: string;
  availableModels: string[];
  blockers: string[];
  providerFailure?: { code: ProviderFailureCode; message: string };
};

const VERSION_DIR_RE = /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/;

export function officialWindowsAgentPath(): string | undefined {
  const base = process.env.LOCALAPPDATA;
  if (!base) return undefined;
  const cmd = path.join(base, 'cursor-agent', 'agent.cmd');
  return fs.existsSync(cmd) ? cmd : undefined;
}

export function latestCursorVersionDir(versionsDir: string): string | undefined {
  if (!fs.existsSync(versionsDir)) return undefined;
  const names = fs.readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && VERSION_DIR_RE.test(entry.name))
    .map((entry) => entry.name);
  if (names.length === 0) return undefined;
  return names.sort((a, b) => cursorVersionSortKey(b) - cursorVersionSortKey(a))[0];
}

function cursorVersionSortKey(name: string): number {
  const datePart = name.split('-')[0] || '';
  const [year, month, day] = datePart.split('.');
  return Number((year || '0') + (month || '0').padStart(2, '0') + (day || '0').padStart(2, '0'));
}

export function resolveCursorLaunch(executable: string): { command: string; prefixArgs: string[] } {
  const resolved = path.resolve(executable);
  const dir = path.dirname(resolved);
  const versionsDir = path.join(dir, 'versions');
  const latest = latestCursorVersionDir(versionsDir);
  if (latest) {
    const node = path.join(versionsDir, latest, process.platform === 'win32' ? 'node.exe' : 'node');
    const index = path.join(versionsDir, latest, 'index.js');
    if (fs.existsSync(node) && fs.existsSync(index)) {
      return { command: node, prefixArgs: [index] };
    }
  }
  return { command: resolved, prefixArgs: [] };
}

export function findAgentExecutable(lookup: () => string | undefined = defaultLookup): string | undefined {
  return lookup();
}

function defaultLookup(): string | undefined {
  const official = officialWindowsAgentPath();
  try {
    const output = execFileSync('where', ['agent'], { encoding: 'utf8', windowsHide: true });
    const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const cmdOrExe = lines.find((line) => /\.(cmd|exe)$/i.test(line));
    if (cmdOrExe) return cmdOrExe;
  } catch {
    // PATH may be stale in this process; fall through to the official installer location.
  }
  return official;
}

export function parseCursorModels(text: string): string[] {
  const ids = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.toLowerCase().startsWith('available')) continue;
    const token = trimmed.split(/\s+/)[0];
    if (token && /^(grok|gpt|claude|cursor|composer)/i.test(token)) ids.add(token);
    const quoted = trimmed.match(/`([^`]+)`/);
    if (quoted) ids.add(quoted[1]);
  }
  return [...ids];
}

export type CursorModelResolution = {
  ok: boolean;
  model?: string;
  reason?: string;
};

export function resolveExactCursorModel(requested: string, listed: string[]): CursorModelResolution {
  const want = requested.trim();
  if (!want || want === UNRESOLVED_CURSOR_MODEL) {
    return { ok: false, reason: 'Requested Cursor model id is unresolved. Run agent models and set the exact id. Do not guess.' };
  }
  if (want.toLowerCase() === 'auto') {
    return { ok: false, reason: 'Do not use Auto. Set the exact Cursor model id. Do not substitute.' };
  }
  if (!listed.includes(want)) {
    return {
      ok: false,
      reason: 'Requested model ' + want + ' is not in agent models output. Available: ' + (listed.join(', ') || '(none listed)') + '. Do not substitute another model.',
    };
  }
  return { ok: true, model: want };
}

export function classifyCursorCliText(text: string): ProviderFailureCode | undefined {
  const lower = text.toLowerCase();
  if (/quota|rate limit|usage exhausted|too many requests/.test(lower)) return 'quota_exhausted';
  if (/unauthoriz|not logged|authentication|please run `?agent login/.test(lower)) return 'auth_error';
  if (/unknown model|model is not available|model .*not (found|available)|unresolved cursor model|requested model .+ is not/.test(lower)) return 'model_unavailable';
  if (/sandbox mode is enabled but not available|sandbox requires macos or linux/.test(lower)) return 'provider_error';
  if (/invalid project config|schema validation failed|unrecognized key/.test(lower)) return 'provider_error';
  if (/not recognized|enoent|executable|not found/.test(lower)) return 'provider_error';
  return undefined;
}

export function preflightCursorCli(input: {
  requestedModel: string;
  lookup?: () => string | undefined;
  run?: (executable: string, args: string[]) => { stdout: string; stderr: string; code: number };
}): CursorPreflight {
  const blockers: string[] = [];
  const executable = findAgentExecutable(input.lookup);
  if (!executable) {
    return {
      ok: false,
      availableModels: [],
      blockers: [
        'Cursor CLI `agent` is not on PATH.',
        'Owner action: in PowerShell run irm \'https://cursor.com/install?win32=true\' | iex',
        'Open a new PowerShell, then: agent --version ; agent login ; agent models',
      ],
      providerFailure: { code: 'provider_error', message: 'agent executable missing' },
    };
  }

  const run = input.run || ((exe, args) => {
    const launch = resolveCursorLaunch(exe);
    try {
      const stdout = execFileSync(launch.command, [...launch.prefixArgs, ...args], {
        encoding: 'utf8',
        windowsHide: true,
      });
      return { stdout, stderr: '', code: 0 };
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; status?: number; message?: string };
      return { stdout: err.stdout || '', stderr: err.stderr || err.message || String(error), code: typeof err.status === 'number' ? err.status : 1 };
    }
  });

  const version = run(executable, ['--version']);
  const status = run(executable, ['status']);
  const modelsOut = run(executable, ['models']);
  const listed = parseCursorModels([modelsOut.stdout, modelsOut.stderr].join('\n'));
  const statusText = [status.stdout, status.stderr].join('\n');
  const authenticated = !/not logged|unauthoriz|please run.*login/i.test(statusText) && status.code === 0;
  if (!authenticated) {
    blockers.push('Cursor CLI is not authenticated. Owner action: agent login');
  }
  const resolved = resolveExactCursorModel(input.requestedModel, listed);
  const unresolvedReason = resolved.ok ? undefined : (resolved.reason || 'Requested Cursor model is unavailable.');
  const modelId = resolved.ok ? resolved.model : undefined;
  if (unresolvedReason) blockers.push(unresolvedReason);

  const providerFailure = !authenticated
    ? { code: 'auth_error' as const, message: blockers.join(' | ') }
    : unresolvedReason
      ? { code: 'model_unavailable' as const, message: unresolvedReason }
      : undefined;

  return {
    ok: blockers.length === 0,
    executable,
    version: version.stdout.trim() || version.stderr.trim(),
    authenticated,
    modelId,
    availableModels: listed,
    blockers,
    providerFailure,
  };
}

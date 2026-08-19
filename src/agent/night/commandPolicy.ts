import { createRequire } from 'node:module';
import { isDenied, type CommandKind, type PolicyResult, type ValidatedCommand } from './types';

const require = createRequire(import.meta.url);

const METACHARS = /(?:&&|\|\||[;|`\n\r]|\$\(|<\(|>>?|<|&)/;

const DENIED_GIT = new Set([
  'push', 'reset', 'clean', 'rebase', 'merge', 'checkout', 'switch', 'stash',
  'branch', 'cherry-pick', 'fetch', 'pull', 'remote', 'submodule', 'am',
  'filter-branch', 'update-index', 'worktree', 'tag',
]);

const ALLOWED_NPM_SCRIPTS = new Set(['lint', 'build', 'test']);

function npmInvocation(npmArgs: string[]): { executable: string; args: string[] } {
  if (process.platform === 'win32') {
    return { executable: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', 'npm.cmd', ...npmArgs] };
  }
  return { executable: 'npm', args: npmArgs };
}

function tsxEntry(): string {
  return require.resolve('tsx/cli');
}

function tscEntry(): string {
  return require.resolve('typescript/bin/tsc');
}

function tokenize(raw: string): PolicyResult<string[]> {
  const text = raw.trim();
  if (!text) return { ok: false, kind: 'denied_command', reason: 'Empty command is not allowed.' };
  if (METACHARS.test(text)) {
    return { ok: false, kind: 'denied_command', reason: 'Command chaining, pipes, and redirects are denied: ' + text };
  }
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? '');
  }
  if (tokens.length === 0) return { ok: false, kind: 'denied_command', reason: 'Could not parse command: ' + text };
  return { ok: true, value: tokens };
}

function deny(reason: string): PolicyResult<ValidatedCommand> {
  return { ok: false, kind: 'denied_command', reason };
}

function allow(kind: CommandKind, executable: string, args: string[], display: string): PolicyResult<ValidatedCommand> {
  return { ok: true, value: { kind, executable, args, display } };
}

function isSafeRelPath(value: string): boolean {
  if (!value || value.startsWith('-')) return false;
  if (value.includes('\0') || value.includes('..')) return false;
  if (value.startsWith('/') || value.startsWith('\\\\') || /^[a-zA-Z]:/.test(value)) return false;
  return true;
}

export function validateNightCommand(raw: string): PolicyResult<ValidatedCommand> {
  const lowered = raw.trim().toLowerCase();
  if (
    lowered.includes('git push')
    || lowered.includes('git reset')
    || lowered.includes('git clean')
    || lowered.includes('.env')
    || lowered.includes('discord')
    || lowered.includes('cctv')
    || /\brm\b/.test(lowered)
    || lowered.includes('deploy')
  ) {
    return deny('Denied command family: ' + raw.trim());
  }

  const parsed = tokenize(raw);
  if (isDenied(parsed)) return deny(parsed.reason);
  const tokens = parsed.value;
  const [head, ...rest] = tokens;

  if (head === 'git') {
    const sub = rest[0];
    if (!sub) return deny('git requires a subcommand.');
    if (DENIED_GIT.has(sub)) return deny('Destructive or remote git is denied: git ' + sub);
    if (sub === 'status') {
      const flags = rest.slice(1);
      if (flags.some((flag) => !['--short', '--porcelain', '-s', '--untracked-files=no'].includes(flag))) {
        return deny('Only git status --short/--porcelain is allowed.');
      }
      return allow('git_status', 'git', ['status', ...(flags.length ? flags : ['--short'])], 'git status --short');
    }
    if (sub === 'diff') {
      const flags = rest.slice(1);
      for (const flag of flags) {
        if (flag === '--' || flag === '--stat' || flag === '--name-only' || flag === '--name-status') continue;
        if (isSafeRelPath(flag)) continue;
        return deny('Unsupported git diff argument: ' + flag);
      }
      return allow('git_diff', 'git', ['diff', ...flags], tokens.join(' '));
    }
    if (sub === 'log') {
      const flags = rest.slice(1);
      let sawN = false;
      for (let i = 0; i < flags.length; i += 1) {
        const flag = flags[i];
        if (flag === '--oneline' || flag === '--') continue;
        if (flag === '-n' && flags[i + 1] && /^\d{1,2}$/.test(flags[i + 1]) && Number(flags[i + 1]) <= 20) {
          sawN = true;
          i += 1;
          continue;
        }
        if (/^-n\d{1,2}$/.test(flag) && Number(flag.slice(2)) <= 20) {
          sawN = true;
          continue;
        }
        if (isSafeRelPath(flag)) continue;
        return deny('Unsupported git log argument: ' + flag);
      }
      const args = sawN ? ['log', ...flags] : ['log', '--oneline', '-n', '10', ...flags];
      return allow('git_log', 'git', args, tokens.join(' '));
    }
    return deny('git ' + sub + ' is not on the Night allowlist.');
  }

  if (head === 'npm') {
    if (rest[0] === 'test') {
      const extra = rest.slice(1);
      if (extra[0] === '--') extra.shift();
      if (extra.some((item) => !isSafeRelPath(item))) return deny('npm test only accepts relative test paths.');
            const npmArgs = ['test', ...(extra.length ? ['--', ...extra] : [])];
      const invoked = npmInvocation(npmArgs);
      return allow('npm_test', invoked.executable, invoked.args, tokens.join(' '));
    }
    if (rest[0] === 'run' && rest[1] && ALLOWED_NPM_SCRIPTS.has(rest[1]) && rest.length === 2) {
      const script = rest[1];
      const kind = script === 'lint' ? 'npm_lint' : script === 'build' ? 'npm_build' : 'npm_test';
      const invoked = npmInvocation(['run', script]);
      return allow(kind, invoked.executable, invoked.args, 'npm run ' + script);
    }
    return deny('npm script is not allowlisted: ' + tokens.join(' '));
  }

  if ((head === 'npx' && rest[0] === 'tsx' && rest[1] === '--test') || (head === 'tsx' && rest[0] === '--test')) {
    const files = head === 'tsx' ? rest.slice(1) : rest.slice(2);
    if (files.length === 0 || files.some((item) => !isSafeRelPath(item) || !/\.test\.(ts|js|mts|cts)$/.test(item))) {
      return deny('tsx --test requires relative *.test.ts paths.');
    }
    return allow('tsx_test', process.execPath, [tsxEntry(), '--test', ...files], tokens.join(' '));
  }

  if (head === 'npx' && rest[0] === 'tsc' && rest.length === 2 && rest[1] === '--noEmit') {
    return allow('tsc_noemit', process.execPath, [tscEntry(), '--noEmit'], 'npx tsc --noEmit');
  }

  return deny('Command is not on the Night allowlist: ' + tokens.join(' '));
}
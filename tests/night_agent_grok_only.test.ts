import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CodingWorkerRouter, defaultWorkers } from '../src/agent/coding/CodingWorkerRouter';
import { CursorCliCodingAgent } from '../src/agent/coding/CursorGrokCodingAgent';
import { buildCursorAgentArgv, buildCursorTaskPrompt, cursorArgvIsSafe, UNRESOLVED_CURSOR_MODEL } from '../src/agent/coding/cursorArgv';
import { classifyCursorCliText, parseCursorModels, preflightCursorCli, resolveCursorLaunch, resolveExactCursorModel } from '../src/agent/coding/cursorPreflight';
import type { CodingAttemptResult, CodingWorker } from '../src/agent/coding/types';
import { assertNightCliPolicy, cliPolicyDenies, nightCliPolicy } from '../src/agent/night/cliPolicy';
import { validateNightCommand } from '../src/agent/night/commandPolicy';
import { NightOrchestrator } from '../src/agent/night/NightOrchestrator';
import { NightWorkspace } from '../src/agent/night/NightWorkspace';
import { parseNightConfig, parseNightTask } from '../src/agent/night/schema';
import { rejectOutOfScopeChanges } from '../src/agent/night/scopeGuard';
import type { NightConfig, NightTask, ProviderFailureCode } from '../src/agent/night/types';
import { isolatedWorktreePath, prepareIsolatedWorktree } from '../src/agent/night/worktreePrepare';

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function gitInit(root: string): void {
  execFileSync('git', ['init'], { cwd: root, windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'night@example.test'], { cwd: root, windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Night Agent'], { cwd: root, windowsHide: true });
  fs.writeFileSync(path.join(root, 'README.md'), '# sandbox\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: root, windowsHide: true });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: root, windowsHide: true });
}

function grokOnlyConfig(overrides: Partial<NightConfig> = {}): NightConfig {
  return parseNightConfig({
    allowDirtyWorkspace: true,
    localQwenFallback: false,
    codexFallback: false,
    stopOnProviderFailure: true,
    workspaceMode: 'isolated-worktree',
    cursorModel: 'grok-4.6-test-id',
    maxTasks: 4,
    maxAttemptsPerTask: 3,
    workerProviders: [{
      id: 'cursor-grok',
      kind: 'cursor-cli',
      enabled: true,
      priority: 100,
      model: 'grok-4.6-test-id',
    }],
    fallbackOn: [],
    ...overrides,
  });
}

function sampleTask(overrides: Partial<NightTask> = {}): NightTask {
  return parseNightTask({
    id: 'NIGHT-001',
    title: 'Add a unit test',
    status: 'READY',
    nightSafe: true,
    priority: 100,
    risk: 'low',
    goal: 'Add deterministic coverage.',
    scope: ['src/', 'tests/'],
    acceptanceCommands: ['npx tsx --test tests/add.test.ts'],
    maxAttempts: 3,
    maxMinutes: 30,
    ...overrides,
  }, { maxAttempts: 3, maxMinutes: 30 });
}

class ProviderFailWorker implements CodingWorker {
  readonly id = 'cursor-grok';
  readonly kind = 'cursor-cli' as const;
  constructor(private readonly code: ProviderFailureCode) {}
  resetContext(): void {}
  async attempt(): Promise<CodingAttemptResult> {
    return {
      workerId: this.id,
      providerKind: this.kind,
      summary: this.code,
      toolCalls: 0,
      contextReset: true,
      providerFailure: { code: this.code, message: this.code + ' from test' },
    };
  }
}

test('missing agent executable is a provider preflight blocker', () => {
  const preflight = preflightCursorCli({
    requestedModel: 'grok-4.6-test-id',
    lookup: () => undefined,
  });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.providerFailure?.code, 'provider_error');
  assert.ok(preflight.blockers.some((item) => /not on PATH/i.test(item)));
  assert.ok(preflight.blockers.some((item) => /cursor.com\/install/i.test(item)));
});

test('unauthenticated Cursor CLI refuses start', () => {
  const preflight = preflightCursorCli({
    requestedModel: 'grok-4.6-test-id',
    lookup: () => 'C:\\fake\\agent.exe',
    run: (_exe, args) => {
      if (args[0] === 'status') return { stdout: 'Not logged in. Please run agent login', stderr: '', code: 1 };
      if (args[0] === 'models') return { stdout: 'grok-4.6-test-id\n', stderr: '', code: 0 };
      return { stdout: 'agent 0.0.0', stderr: '', code: 0 };
    },
  });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.authenticated, false);
  assert.equal(preflight.providerFailure?.code, 'auth_error');
});

test('exact model resolution accepts only a listed id', () => {
  const listed = parseCursorModels([
    'Available models',
    'auto - Auto (default)',
    'cursor-grok-4.6-high-fast - Cursor Grok 4.6 Fast',
    'cursor-grok-4.6-xhigh-fast - Cursor Grok 4.6 Extra High Fast',
  ].join('\n'));
  assert.equal(listed.includes('auto'), false);
  assert.ok(listed.includes('cursor-grok-4.6-xhigh-fast'));
  assert.equal(resolveExactCursorModel('cursor-grok-4.6-xhigh-fast', listed).ok, true);
  assert.equal(resolveExactCursorModel('auto', listed).ok, false);
  const unknown = resolveExactCursorModel('grok-4.6-guessed', listed);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.match(unknown.reason || '', /Do not substitute/);
  const unresolved = resolveExactCursorModel(UNRESOLVED_CURSOR_MODEL, listed);
  assert.equal(unresolved.ok, false);
});

test('stream-json that echoes the task prompt is not a model_unavailable failure', () => {
  const echoed = [
    '{"type":"system","subtype":"init","model":"Cursor Grok 4.6 Extra High Fast"}',
    'Shell, Git, package install, network, WebFetch, and MCP are unavailable.',
  ].join('\n');
  assert.equal(classifyCursorCliText(echoed), undefined);
  assert.equal(classifyCursorCliText('Error: unknown model cursor-grok-4.6-guessed'), 'model_unavailable');
});

test('unknown requested model refuses start', () => {
  const preflight = preflightCursorCli({
    requestedModel: 'not-a-real-grok-id',
    lookup: () => 'C:\\fake\\agent.exe',
    run: (_exe, args) => {
      if (args[0] === 'status') return { stdout: 'Logged in as owner', stderr: '', code: 0 };
      if (args[0] === 'models') return { stdout: 'grok-4.6-test-id\n', stderr: '', code: 0 };
      return { stdout: 'agent 0.0.0', stderr: '', code: 0 };
    },
  });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.providerFailure?.code, 'model_unavailable');
});

test('safe argv construction forbids resume/continue/yolo', () => {
  const argv = buildCursorAgentArgv({
    model: 'grok-4.6-test-id',
    workspace: 'C:/night-worktree',
    prompt: 'NIGHT_SAFE patch only',
    useForce: true,
  });
  assert.ok(argv.includes('--print'));
  assert.ok(argv.includes('--sandbox'));
  assert.ok(argv.includes(process.platform === 'win32' ? 'disabled' : 'enabled'));
  assert.ok(argv.includes('--workspace'));
  assert.ok(argv.includes('--model'));
  assert.ok(argv.includes('grok-4.6-test-id'));
  assert.ok(argv.includes('--output-format'));
  assert.ok(argv.includes('stream-json'));
  assert.ok(argv.includes('--force'));
  assert.equal(cursorArgvIsSafe(argv), true);
  assert.throws(() => buildCursorAgentArgv({
    model: UNRESOLVED_CURSOR_MODEL,
    workspace: 'C:/night-worktree',
    prompt: 'x',
    useForce: false,
  }));
  const prompt = buildCursorTaskPrompt({
    taskId: 'NIGHT-001',
    title: 't',
    goal: 'g',
    scope: ['src/'],
    acceptance: ['npm run lint'],
    previousErrors: [],
  });
  assert.match(prompt, /NIGHT_SAFE/);
  assert.match(prompt, /Shell, Git/);
});

test('fresh Cursor process per task increment spawn count', async () => {
  const root = tempDir('night-spawn-');
  gitInit(root);
  const config = grokOnlyConfig({ workspaceRoot: root });
  let runs = 0;
  const agent = new CursorCliCodingAgent(config, 'grok-4.6-test-id', {
    executable: 'agent',
    runner: async () => {
      runs += 1;
      return { code: 0, stdout: '{"type":"result"}', stderr: '' };
    },
  });
  await agent.attempt({
    task: sampleTask(),
    attempt: 1,
    previousErrors: [],
    contextPacket: '',
    tools: {} as never,
  });
  await agent.attempt({
    task: sampleTask({ id: 'NIGHT-002' }),
    attempt: 1,
    previousErrors: [],
    contextPacket: '',
    tools: {} as never,
  });
  assert.equal(runs, 2);
  assert.equal(agent.spawnCount, 2);
});

test('project CLI policy denies Shell, WebFetch, MCP, and private data', () => {
  const policy = nightCliPolicy();
  assert.deepEqual(assertNightCliPolicy(policy), []);
  assert.equal('version' in policy, false);
  assert.equal(cliPolicyDenies(policy, 'Shell(*)'), true);
  assert.equal(cliPolicyDenies(policy, 'WebFetch(*)'), true);
  assert.equal(cliPolicyDenies(policy, 'Mcp(*:*)'), true);
  assert.equal(cliPolicyDenies(policy, 'Read(.env*)'), true);
  assert.equal(cliPolicyDenies(policy, 'Write(data/**)'), true);
});

test('controller repo may be dirty when the isolated target is clean', () => {
  const target = tempDir('night-target-');
  gitInit(target);
  const workspace = new NightWorkspace(target);
  const allowed = workspace.assertSafeForUnattended(grokOnlyConfig({
    allowDirtyWorkspace: false,
    workspaceMode: 'isolated-worktree',
    workspaceRoot: target,
  }));
  assert.equal(allowed.ok, true);
});

test('target dirty workspace refuses start', () => {
  const target = tempDir('night-dirty-target-');
  gitInit(target);
  fs.writeFileSync(path.join(target, 'open-edit.ts'), 'x', 'utf8');
  const refused = new NightWorkspace(target).assertSafeForUnattended(grokOnlyConfig({
    allowDirtyWorkspace: false,
    workspaceMode: 'isolated-worktree',
    workspaceRoot: target,
  }));
  assert.equal(refused.ok, false);
});

test('isolated worktree prepare requires acknowledge when controller is dirty and never copies dirty files', () => {
  const controller = tempDir('night-ctrl-');
  gitInit(controller);
  fs.writeFileSync(path.join(controller, 'dirty-primary.ts'), 'not in worktree\n', 'utf8');
  const blocked = prepareIsolatedWorktree({ controllerRoot: controller, name: 'night-test' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.blockers.join(' '), /acknowledge-head-only/);
  const prepared = prepareIsolatedWorktree({
    controllerRoot: controller,
    name: 'night-test',
    acknowledgeHeadOnly: true,
  });
  assert.equal(prepared.ok, true, prepared.blockers.concat(prepared.notes).join(' | '));
  assert.ok(prepared.path && fs.existsSync(prepared.path));
  assert.ok(prepared.baseCommit);
  assert.equal(prepared.targetClean, true);
  assert.equal(fs.existsSync(path.join(prepared.path!, 'dirty-primary.ts')), false);
  assert.ok(fs.existsSync(path.join(prepared.path!, '.cursor', 'cli.json')));
  const second = prepareIsolatedWorktree({
    controllerRoot: controller,
    name: 'night-test',
    acknowledgeHeadOnly: true,
  });
  assert.equal(second.created, false);
  assert.equal(second.ok, true);
  try {
    execFileSync('git', ['worktree', 'remove', '--force', prepared.path!], { cwd: controller, windowsHide: true });
  } catch {
    fs.rmSync(prepared.path!, { recursive: true, force: true });
  }
});

test('Grok changes outside task scope are restored per file', () => {
  const root = tempDir('night-scope-restore-');
  gitInit(root);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'ok.ts'), 'export const ok = true;\n', 'utf8');
  fs.writeFileSync(path.join(root, 'outside.md'), 'escaped\n', 'utf8');
  const check = rejectOutOfScopeChanges(root, sampleTask({ scope: ['src/'] }));
  assert.ok(check.rejected.includes('outside.md'));
  assert.equal(fs.existsSync(path.join(root, 'outside.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'src', 'ok.ts')), true);
});

test('grok-only config does not construct a Qwen worker', () => {
  const config = grokOnlyConfig();
  assert.equal(config.localQwenFallback, false);
  assert.deepEqual(config.fallbackOn, []);
  const workers = defaultWorkers(config);
  assert.equal(workers.some((item) => item.kind === 'local-qwen'), false);
  assert.equal(workers[0]?.kind, 'cursor-cli');
});

test('provider failure stops the run and does not start remaining tasks', async () => {
  const root = tempDir('night-provider-stop-');
  gitInit(root);
  let qwenCalls = 0;
  const unusedQwen: CodingWorker = {
    id: 'local-qwen',
    kind: 'local-qwen',
    resetContext() {},
    async attempt() {
      qwenCalls += 1;
      throw new Error('Qwen must not run tonight');
    },
  };
  const result = await new NightOrchestrator({
    config: grokOnlyConfig({ allowDirtyWorkspace: true }),
    tasks: [
      sampleTask({ id: 'NIGHT-A', acceptanceCommands: ['npm run lint'] }),
      sampleTask({ id: 'NIGHT-B', acceptanceCommands: ['npm run lint'] }),
    ],
    workspace: new NightWorkspace(root),
    worker: new CodingWorkerRouter(grokOnlyConfig(), [new ProviderFailWorker('quota_exhausted'), unusedQwen]),
    commandRunner: async () => ({ exitCode: 0, stdout: 'ok', stderr: '' }),
  }).run();
  assert.equal(result.state.tasks['NIGHT-A'].status, 'BLOCKED_PROVIDER');
  assert.equal(result.state.tasks['NIGHT-B'].status, 'BLOCKED_PROVIDER');
  assert.equal(result.state.status, 'stopped');
  assert.equal(qwenCalls, 0);
  assert.match(fs.readFileSync(result.reportPath!, 'utf8'), /BLOCKED_PROVIDER|quota_exhausted|localQwenFallback: false/);
});

test('no automatic commit, push, reset, or clean', () => {
  assert.equal(validateNightCommand('git commit -am night').ok, false);
  assert.equal(validateNightCommand('git push origin HEAD').ok, false);
  assert.equal(validateNightCommand('git reset --hard').ok, false);
  assert.equal(validateNightCommand('git clean -fd').ok, false);
});

test('isolatedWorktreePath is a sibling of the controller, not inside it', () => {
  const controller = 'C:\\Users\\someone\\Documents\\ExampleRepo';
  const next = isolatedWorktreePath(controller, 'night-2026-08-19');
  assert.equal(path.win32.basename(next), 'ExampleRepo-night-2026-08-19');
  assert.ok(!next.startsWith(controller + path.sep) && !next.startsWith(controller + '/'));
});

test('resolveCursorLaunch uses official versioned node.exe instead of agent.cmd', () => {
  const root = tempDir('cursor-launch-');
  const versions = path.join(root, 'versions', '2026.08.11-e8db854');
  fs.mkdirSync(versions, { recursive: true });
  fs.writeFileSync(path.join(versions, 'node.exe'), 'fake', 'utf8');
  fs.writeFileSync(path.join(versions, 'index.js'), 'fake', 'utf8');
  fs.writeFileSync(path.join(root, 'agent.cmd'), 'fake', 'utf8');
  const launch = resolveCursorLaunch(path.join(root, 'agent.cmd'));
  assert.equal(launch.command, path.join(versions, 'node.exe'));
  assert.deepEqual(launch.prefixArgs, [path.join(versions, 'index.js')]);
});

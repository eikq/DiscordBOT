import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ScriptedCodingAgent } from '../src/agent/coding/ScriptedCodingAgent';
import { CodingWorkerRouter } from '../src/agent/coding/CodingWorkerRouter';
import { CursorGrokCodingAgent } from '../src/agent/coding/CursorGrokCodingAgent';
import { validateNightCommand } from '../src/agent/night/commandPolicy';
import { NightOrchestrator } from '../src/agent/night/NightOrchestrator';
import { NightPolicy } from '../src/agent/night/NightPolicy';
import { NightTaskQueue } from '../src/agent/night/NightTaskQueue';
import { NightToolHost, defaultCommandRunner } from '../src/agent/night/NightToolHost';
import { NightWorkspace } from '../src/agent/night/NightWorkspace';
import { parseNightConfig, parseNightTask, parseNightTaskFile } from '../src/agent/night/schema';
import type { NightConfig, NightTask } from '../src/agent/night/types';
import type { CommandRunner } from '../src/agent/night/NightToolHost';

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

function baseConfig(overrides: Partial<NightConfig> = {}): NightConfig {
  return { ...parseNightConfig({ allowDirtyWorkspace: true, maxTasks: 4, maxAttemptsPerTask: 3 }), ...overrides };
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
    maxFilesChanged: 6,
    dependencies: [],
    requiresHuman: false,
    requiresNetwork: false,
    requiresSecrets: false,
    ...overrides,
  }, { maxAttempts: 3, maxMinutes: 30 });
}

const passRunner: CommandRunner = async () => ({ exitCode: 0, stdout: 'ok', stderr: '' });
const failRunner: CommandRunner = async (command) => ({
  exitCode: 1,
  stdout: '',
  stderr: 'FAIL ' + command.display,
});

test('task schema accepts a valid NIGHT_SAFE task and rejects missing fields', () => {
  const parsed = parseNightTaskFile({
    version: 1,
    tasks: [{
      id: 'A',
      title: 't',
      status: 'READY',
      nightSafe: true,
      goal: 'g',
      scope: ['src/'],
      acceptanceCommands: ['npm run lint'],
    }],
  }, { maxAttempts: 3, maxMinutes: 30 });
  assert.equal(parsed.tasks[0].id, 'A');
  assert.throws(() => parseNightTask({ id: 'B', title: 't' }, { maxAttempts: 3, maxMinutes: 30 }));
});

test('queue selects READY nightSafe tasks whose dependencies passed', () => {
  const config = baseConfig();
  const policy = new NightPolicy(config);
  const tasks = [
    sampleTask({ id: 'NIGHT-DEP', status: 'READY' }),
    sampleTask({ id: 'NIGHT-NEXT', priority: 200, dependencies: ['NIGHT-DEP'] }),
    sampleTask({ id: 'NIGHT-UNSAFE', nightSafe: false, priority: 300 }),
    sampleTask({ id: 'NIGHT-HUMAN', requiresHuman: true, priority: 400 }),
  ];
  const queue = new NightTaskQueue(tasks, config, policy);
  assert.deepEqual(queue.eligible().map((item) => item.id), ['NIGHT-DEP']);
  queue.update('NIGHT-DEP', 'PASS');
  assert.deepEqual(queue.eligible().map((item) => item.id), ['NIGHT-NEXT']);
});

test('path scope and private-path denial block writes and reads', async () => {
  const root = tempDir('night-scope-');
  gitInit(root);
  const task = sampleTask({ scope: ['src/', 'tests/'] });
  const tools = new NightToolHost(new NightWorkspace(root), new NightPolicy(baseConfig()), task, () => undefined, passRunner);
  const env = await tools.execute('read_file', { path: '.env' });
  assert.match(env.content, /DENIED/);
  const brain = await tools.execute('read_file', { path: 'data/brain/secrets.json' });
  assert.match(brain.content, /DENIED/);
  const outside = await tools.execute('write_file', { path: 'docs/README.md', contents: 'nope' });
  assert.match(outside.content, /DENIED/);
  const ok = await tools.execute('write_file', { path: 'tests/add.test.ts', contents: 'ok' });
  assert.match(ok.content, /Wrote tests\/add.test.ts/);
});

test('command allowlist denies push, reset, clean, chaining, and traversal', () => {
  assert.equal(validateNightCommand('npx tsx --test tests/add.test.ts').ok, true);
  assert.equal(validateNightCommand('npm run lint').ok, true);
  assert.equal(validateNightCommand('git status --short').ok, true);
  assert.equal(validateNightCommand('git push origin HEAD').ok, false);
  assert.equal(validateNightCommand('git reset --hard').ok, false);
  assert.equal(validateNightCommand('git clean -fd').ok, false);
  assert.equal(validateNightCommand('npm test -- && rm -rf /').ok, false);
  assert.equal(validateNightCommand('npx tsx --test ../secret.test.ts').ok, false);
});

test('workspace traversal and dirty-worktree refusal', () => {
  const root = tempDir('night-dirty-');
  gitInit(root);
  fs.writeFileSync(path.join(root, 'dirty.txt'), 'x', 'utf8');
  const workspace = new NightWorkspace(root);
  const refused = workspace.assertSafeForUnattended(baseConfig({ allowDirtyWorkspace: false }));
  assert.equal(refused.ok, false);
  const policy = new NightPolicy(baseConfig());
  const escape = policy.resolveRead(root, '../outside.txt');
  assert.equal(escape.ok, false);
});

test('orchestrator PASSes when acceptance commands succeed and persists state', async () => {
  const root = tempDir('night-pass-');
  gitInit(root);
  const worker = new ScriptedCodingAgent('scripted-pass', async ({ tools }) => {
    await tools.execute('write_file', { path: 'tests/add.test.ts', contents: 'test("add", () => {});' });
  });
  const result = await new NightOrchestrator({
    config: baseConfig(),
    tasks: [sampleTask()],
    workspace: new NightWorkspace(root),
    worker,
    commandRunner: passRunner,
    contextFiles: { 'AGENTS.md': 'rules' },
  }).run();
  assert.equal(result.refused, false);
  assert.equal(result.state.tasks['NIGHT-001'].status, 'PASS');
  assert.ok(fs.existsSync(path.join(root, '.agent', 'night', 'state.json')));
  assert.ok(result.reportPath && fs.existsSync(result.reportPath));
  assert.match(fs.readFileSync(result.reportPath, 'utf8'), /NIGHT-001/);
});

test('orchestrator retries then BLOCKs, writes escalation, and continues the next task', async () => {
  const root = tempDir('night-block-');
  gitInit(root);
  let resets = 0;
  const worker = new ScriptedCodingAgent('scripted-fail', async (input) => {
    if (input.task.id === 'NIGHT-FAIL') return;
    await input.tools.execute('write_file', { path: 'src/ok.ts', contents: 'export const ok = true;\n' });
  });
  const originalReset = worker.resetContext.bind(worker);
  worker.resetContext = () => {
    resets += 1;
    originalReset();
  };
  const failThenPass: CommandRunner = async (command, cwd) => {
    if (command.display.includes('missing-forever')) return { exitCode: 1, stdout: '', stderr: 'still failing' };
    return passRunner(command, cwd);
  };
  const result = await new NightOrchestrator({
    config: baseConfig({ maxTasks: 2 }),
    tasks: [
      sampleTask({
        id: 'NIGHT-FAIL',
        title: 'Impossible acceptance',
        acceptanceCommands: ['npx tsx --test tests/missing-forever.test.ts'],
        maxAttempts: 3,
      }),
      sampleTask({ id: 'NIGHT-OK', title: 'Independent task', acceptanceCommands: ['npm run lint'] }),
    ],
    workspace: new NightWorkspace(root),
    worker,
    commandRunner: failThenPass,
  }).run();
  assert.equal(result.state.tasks['NIGHT-FAIL'].status, 'BLOCKED');
  assert.equal(result.state.tasks['NIGHT-FAIL'].attempts.length, 3);
  assert.ok(result.state.tasks['NIGHT-FAIL'].escalationPath);
  assert.ok(fs.existsSync(result.state.tasks['NIGHT-FAIL'].escalationPath!));
  assert.equal(result.state.tasks['NIGHT-OK'].status, 'PASS');
  assert.ok(resets >= 4);
  assert.match(fs.readFileSync(result.reportPath!, 'utf8'), /Blocked/);
});

test('time limit stops a task before endless retries', async () => {
  const root = tempDir('night-time-');
  gitInit(root);
  let clock = 1_000;
  const result = await new NightOrchestrator({
    config: baseConfig(),
    tasks: [sampleTask({ maxMinutes: 1, maxAttempts: 3 })],
    workspace: new NightWorkspace(root),
    worker: new ScriptedCodingAgent('slow', async () => undefined),
    commandRunner: failRunner,
    now: () => {
      clock += 70_000;
      return clock;
    },
  }).run();
  const record = result.state.tasks['NIGHT-001'];
  assert.ok(record.status === 'BLOCKED' || record.status === 'FAILED_LIMIT');
  assert.ok(record.attempts.length < 3 || /maxMinutes|Failed/.test(record.blockedReason || ''));
});

test('cloud escalation unavailable saves a local packet and continues', async () => {
  const root = tempDir('night-cloud-');
  gitInit(root);
  const result = await new NightOrchestrator({
    config: baseConfig({ cloudEscalation: { enabled: false } }),
    tasks: [sampleTask({ maxAttempts: 1 })],
    workspace: new NightWorkspace(root),
    worker: new ScriptedCodingAgent('fail', async () => undefined),
    commandRunner: failRunner,
    cloud: {
      enabled: false,
      submit: async () => ({ ok: false, reason: 'quota unavailable' }),
    },
  }).run();
  assert.equal(result.state.tasks['NIGHT-001'].status, 'BLOCKED');
  assert.ok(result.state.resourceNotes.some((note) => /quota unavailable|disabled|unavailable/i.test(note)));
});

test('dirty primary workspace refuses unattended coding', async () => {
  const root = tempDir('night-refuse-');
  gitInit(root);
  fs.writeFileSync(path.join(root, 'open-edit.ts'), 'x', 'utf8');
  const result = await new NightOrchestrator({
    config: baseConfig({ allowDirtyWorkspace: false }),
    tasks: [sampleTask()],
    workspace: new NightWorkspace(root),
    worker: new ScriptedCodingAgent('unused', async () => undefined),
    commandRunner: passRunner,
  }).run();
  assert.equal(result.refused, true);
  assert.equal(result.state.status, 'refused');
});

test('Cursor provider failure falls back to the next worker when localQwenFallback is enabled', async () => {
  const config = baseConfig({
    localQwenFallback: true,
    stopOnProviderFailure: false,
    workerProviders: [
      { id: 'cursor-grok', kind: 'cursor-cli', enabled: true, priority: 100, model: 'RESOLVE_WITH_AGENT_LIST_MODELS' },
      { id: 'local-qwen', kind: 'scripted', enabled: true, priority: 50 },
    ],
    fallbackOn: ['quota_exhausted', 'model_unavailable', 'auth_error', 'provider_error'],
  });
  const qwen = new ScriptedCodingAgent('local-qwen', async ({ tools }) => {
    await tools.execute('write_file', { path: 'src/ok.ts', contents: 'export {}\n' });
  });
  const router = new CodingWorkerRouter(config, [new CursorGrokCodingAgent(config, 'RESOLVE_WITH_AGENT_LIST_MODELS'), qwen]);
  const root = tempDir('night-fallback-');
  gitInit(root);
  const result = await new NightOrchestrator({
    config,
    tasks: [sampleTask({ acceptanceCommands: ['npm run lint'] })],
    workspace: new NightWorkspace(root),
    worker: router,
    commandRunner: passRunner,
  }).run();
  assert.equal(result.state.tasks['NIGHT-001'].status, 'PASS');
  assert.equal(result.state.tasks['NIGHT-001'].attempts[0].workerId, 'local-qwen');
});

test('Jarvis Core conversation path does not import the Night coding tools', () => {
  const core = fs.readFileSync(path.join(process.cwd(), 'src/jarvis/standalone/LocalLlmJarvisCore.ts'), 'utf8');
  const jarvisIndex = fs.readFileSync(path.join(process.cwd(), 'src/jarvis/index.ts'), 'utf8');
  assert.doesNotMatch(core, /src\/agent|NightToolHost|agent\/coding/);
  assert.doesNotMatch(jarvisIndex, /src\/agent|NightToolHost/);
});

test('allowlisted tsx --test actually runs through Node, not npx.cmd', async () => {
  const root = tempDir('night-runner-');
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tests', 'ok.test.ts'), 'import test from "node:test"; import assert from "node:assert/strict"; test("ok", () => assert.equal(1, 1));\n', 'utf8');
  const validated = validateNightCommand('npx tsx --test tests/ok.test.ts');
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.value.executable, process.execPath);
  const ran = await defaultCommandRunner(validated.value, root);
  assert.equal(ran.exitCode, 0, ran.stderr || ran.stdout);
});

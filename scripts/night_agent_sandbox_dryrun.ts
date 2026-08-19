import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ScriptedCodingAgent } from '../src/agent/coding/ScriptedCodingAgent';
import { LocalQwenCodingAgent } from '../src/agent/coding/LocalQwenCodingAgent';
import { NightOrchestrator } from '../src/agent/night/NightOrchestrator';
import { parseNightConfig, parseNightTask } from '../src/agent/night/schema';
import { NightWorkspace } from '../src/agent/night/NightWorkspace';
import type { CodingAttemptInput, CodingWorker } from '../src/agent/coding/types';
import type { CodingAttemptResult } from '../src/agent/coding/types';

function gitInit(root: string): void {
  execFileSync('git', ['init'], { cwd: root, windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'night@example.test'], { cwd: root, windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Night Agent'], { cwd: root, windowsHide: true });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'night-sandbox-'));
gitInit(root);
fs.mkdirSync(path.join(root, 'src'), { recursive: true });
fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
fs.writeFileSync(path.join(root, 'src', 'add.ts'), 'export function add(a: number, b: number): number {\n  return a + b;\n}\n', 'utf8');
fs.writeFileSync(path.join(root, 'src', 'typo.ts'), 'export const value: number = "oops";\n', 'utf8');
fs.writeFileSync(path.join(root, 'README.md'), '# Sandbox\n\nUndocumented helper lives in src/add.ts.\n', 'utf8');
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
  name: 'night-sandbox',
  private: true,
  type: 'module',
  scripts: { lint: 'node -e "process.exit(0)"' },
}, null, 2), 'utf8');
fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Sandbox only. Stay in src/ and tests/.\n', 'utf8');
fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"target":"ES2022","module":"ESNext","strict":true,"noEmit":true,"skipLibCheck":true},"include":["src/**/*.ts"]}\n', 'utf8');
execFileSync('git', ['add', '.'], { cwd: root, windowsHide: true });
execFileSync('git', ['commit', '-m', 'sandbox seed'], { cwd: root, windowsHide: true });

const config = parseNightConfig({
  allowDirtyWorkspace: false,
  maxTasks: 4,
  maxAttemptsPerTask: 3,
  qwen: { contextTokens: Number(process.env.NIGHT_QWEN_CONTEXT_TOKENS || 32768) },
});
config.workspaceRoot = root;

const defaults = { maxAttempts: 3, maxMinutes: 15 };
const tasks = [
  parseNightTask({
    id: 'SANDBOX-001',
    title: 'Add a deterministic unit test for add()',
    status: 'READY',
    nightSafe: true,
    priority: 100,
    goal: 'Create tests/add.test.ts that imports add from ../src/add.ts and asserts add(2, 3) === 5.',
    scope: ['src/', 'tests/'],
    acceptanceCommands: ['npx tsx --test tests/add.test.ts'],
  }, defaults),
  parseNightTask({
    id: 'SANDBOX-002',
    title: 'Fix the intentional type error in typo.ts',
    status: 'READY',
    nightSafe: true,
    priority: 90,
    goal: 'src/typo.ts currently assigns a string to a number. Change it to export const value: number = 1.',
    scope: ['src/'],
    acceptanceCommands: ['npx tsc --noEmit'],
  }, defaults),
  parseNightTask({
    id: 'SANDBOX-003',
    title: 'Document add() in README from verified code',
    status: 'READY',
    nightSafe: true,
    priority: 80,
    goal: 'Update README.md to mention that add(a, b) returns a + b, based on src/add.ts.',
    scope: ['README.md'],
    acceptanceCommands: ['npm run lint'],
  }, defaults),
  parseNightTask({
    id: 'SANDBOX-FAIL',
    title: 'Simulated failing task',
    status: 'READY',
    nightSafe: true,
    priority: 10,
    goal: 'This task is intended to fail acceptance three times.',
    scope: ['src/'],
    acceptanceCommands: ['npx tsx --test tests/missing-forever.test.ts'],
  }, defaults),
];

class DryRunWorker implements CodingWorker {
  readonly id = 'dry-run';
  readonly kind = 'local-qwen' as const;
  private readonly qwen = new LocalQwenCodingAgent(config);
  private readonly fail = new ScriptedCodingAgent('scripted-fail', async () => undefined);
  resets = 0;

  resetContext(): void {
    this.resets += 1;
    this.qwen.resetContext();
    this.fail.resetContext();
  }

  async attempt(input: CodingAttemptInput): Promise<CodingAttemptResult> {
    if (input.task.id === 'SANDBOX-FAIL') return this.fail.attempt(input);
    return this.qwen.attempt(input);
  }
}

const worker = new DryRunWorker();
console.log('sandbox workspace: ' + root);
const result = await new NightOrchestrator({
  config,
  tasks,
  workspace: new NightWorkspace(root),
  worker,
  contextFiles: { 'AGENTS.md': fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8') },
}).run();

const summary = {
  workspace: root,
  status: result.state.status,
  refused: result.refused,
  resets: worker.resets,
  tasks: Object.fromEntries(Object.entries(result.state.tasks).map(([id, record]) => [id, {
    status: record.status,
    attempts: record.attempts.length,
    worker: record.attempts.map((item) => item.workerId),
    files: record.filesChanged,
    escalation: record.escalationPath,
  }])),
  report: result.reportPath,
};
const out = path.join(process.cwd(), 'benchmarks', 'night_sandbox_dryrun.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(summary, null, 2));
console.log('wrote ' + out);
process.exitCode = result.state.tasks['SANDBOX-FAIL']?.status === 'BLOCKED' ? 0 : 1;
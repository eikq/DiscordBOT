import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CodingWorker } from '../coding/types';
import { CodingWorkerRouter } from '../coding/CodingWorkerRouter';
import { NightEscalation, type CloudEscalationAdapter, DisabledCloudEscalation } from './NightEscalation';
import { NightPolicy } from './NightPolicy';
import { NightReporter } from './NightReporter';
import { NightResourceGuard, looksLikeOom, isGuardStop } from './NightResourceGuard';
import { NightStateStore } from './NightStateStore';
import { NightTaskQueue } from './NightTaskQueue';
import { NightToolHost, defaultCommandRunner, type CommandRunner } from './NightToolHost';
import { NightWorkspace } from './NightWorkspace';
import { isPathInsideScope } from './paths';
import { listChangedFiles, rejectOutOfScopeChanges, snapshotChangedFiles } from './scopeGuard';
import { isDenied, type NightConfig, type NightRunState, type NightTask, type SafetyEvent, type TaskAttemptRecord } from './types';
import { notePrivateProviderConstruction } from '../../jarvis/edition/providers';

export type NightOrchestratorOptions = {
  config: NightConfig;
  tasks: NightTask[];
  workspace: NightWorkspace;
  worker?: CodingWorker;
  commandRunner?: CommandRunner;
  cloud?: CloudEscalationAdapter;
  now?: () => number;
  contextFiles?: Record<string, string>;
};

export type NightRunResult = {
  state: NightRunState;
  reportPath?: string;
  refused: boolean;
};

export class NightOrchestrator {
  private readonly config: NightConfig;
  private readonly workspace: NightWorkspace;
  private readonly policy: NightPolicy;
  private readonly queue: NightTaskQueue;
  private readonly store: NightStateStore;
  private readonly reporter: NightReporter;
  private readonly escalation: NightEscalation;
  private readonly guard: NightResourceGuard;
  private readonly worker: CodingWorker;
  private readonly runCommand: CommandRunner;
  private readonly now: () => number;
  private readonly contextFiles: Record<string, string>;

  constructor(options: NightOrchestratorOptions) {
    notePrivateProviderConstruction('nightAgent');
    this.config = options.config;
    this.workspace = options.workspace;
    this.policy = new NightPolicy(options.config);
    this.queue = new NightTaskQueue(options.tasks, options.config, this.policy);
    this.store = new NightStateStore(options.workspace.root);
    this.reporter = new NightReporter(this.store);
    this.escalation = new NightEscalation(options.cloud ? this.store : this.store, options.cloud || new DisabledCloudEscalation());
    this.now = options.now || (() => Date.now());
    this.guard = new NightResourceGuard(options.config, this.now, this.now());
    this.worker = options.worker || new CodingWorkerRouter(options.config);
    this.runCommand = options.commandRunner || defaultCommandRunner;
    this.contextFiles = options.contextFiles || {};
  }

  async run(): Promise<NightRunResult> {
    this.store.ensureLayout();
    const safety = this.workspace.assertSafeForUnattended(this.config);
    const startedAt = new Date(this.now()).toISOString();
    const info = this.workspace.inspect();
    const initial: NightRunState = {
      version: 1,
      runId: randomUUID(),
      startedAt,
      updatedAt: startedAt,
      stopAt: this.config.stopAt,
      status: 'running',
      workspaceRoot: this.workspace.root,
      branch: info.branch,
      profile: 'DEV_NIGHT',
      qwenContextTokens: this.config.qwen.contextTokens,
      tasks: {},
      safetyEvents: [],
      resourceNotes: [],
      noPushConfirmed: true,
    };

    if (isDenied(safety)) {
      initial.status = 'refused';
      initial.refusedReason = safety.reason;
      this.store.start(initial);
      const reportPath = this.reporter.write(this.store.current(), this.config, new Date(this.now()));
      return { state: this.store.current(), reportPath, refused: true };
    }

    this.store.start(initial);
    this.store.writeTasksFile({ version: 1, tasks: this.queue.all() });
    for (const skipped of this.queue.skipUnsafeReady()) {
      this.store.putTask({
        taskId: skipped.id,
        title: skipped.title,
        status: skipped.status,
        attempts: [],
        filesChanged: [],
        durationMs: 0,
        blockedReason: skipped.status === 'NEEDS_HUMAN_VERIFY' ? 'requiresHuman' : 'not NIGHT_SAFE',
      });
    }

    let processed = 0;
    while (processed < this.config.maxTasks) {
      const guard = this.guard.check(this.workspace.root);
      if (isGuardStop(guard)) {
        this.store.addResourceNote("reason" in guard ? guard.reason : "resource guard stopped");
        this.store.current().status = 'stopped';
        break;
      }
      const task = this.queue.next();
      if (!task) break;
      processed += 1;
      const outcome = await this.runTask(task);
      this.worker.resetContext();
      if (outcome === 'stop-provider') break;
    }

    const state = this.store.current();
    if (state.status === 'running') state.status = 'completed';
    state.endedAt = new Date(this.now()).toISOString();
    this.store.writeTasksFile({ version: 1, tasks: this.queue.all() });
    this.store.save();
    const reportPath = this.reporter.write(state, this.config, new Date(this.now()));
    return { state, reportPath, refused: false };
  }

  private async runTask(task: NightTask): Promise<'continue' | 'stop-provider'> {
    const taskStarted = this.now();
    this.queue.update(task.id, 'IN_PROGRESS');
    this.store.current().currentTaskId = task.id;
    this.store.save();

    const attempts: TaskAttemptRecord[] = [];
    const errors: string[] = [];
    let filesChanged: string[] = [];
    let passed = false;

    for (let attemptNo = 1; attemptNo <= task.maxAttempts; attemptNo += 1) {
      if (this.now() - taskStarted > task.maxMinutes * 60_000) {
        errors.push('Task maxMinutes exceeded.');
        break;
      }
      const guard = this.guard.check(this.workspace.root);
      if (isGuardStop(guard)) {
        errors.push("reason" in guard ? guard.reason : "resource guard stopped");
        this.store.addResourceNote("reason" in guard ? guard.reason : "resource guard stopped");
        break;
      }

      const tools = new NightToolHost(
        this.workspace,
        this.policy,
        task,
        (event) => this.store.addSafety({ ...event, at: new Date(this.now()).toISOString() } as SafetyEvent),
        this.runCommand,
      );
      this.worker.resetContext();
      const startedAt = new Date(this.now()).toISOString();
      const before = snapshotChangedFiles(this.workspace.root);
      const result = await this.worker.attempt({
        task,
        attempt: attemptNo,
        previousErrors: errors,
        contextPacket: buildContextPacket(task, this.contextFiles, errors),
        tools,
      });
      let scope = { changed: [] as string[], rejected: [] as string[], restored: [] as string[] };
      try {
        scope = rejectOutOfScopeChanges(this.workspace.root, task, before);
      } catch (error) {
        errors.push('Scope guard failed: ' + (error instanceof Error ? error.message : String(error)));
      }
      if (scope.rejected.length) {
        this.store.addSafety({
          at: new Date(this.now()).toISOString(),
          taskId: task.id,
          kind: 'denied_write',
          detail: 'Restored out-of-scope files: ' + scope.rejected.join(', '),
        });
        errors.push('Out-of-scope files restored: ' + scope.rejected.join(', '));
      }
      filesChanged = unique([
        ...filesChanged,
        ...tools.filesChanged(),
        ...listChangedFiles(this.workspace.root).filter((rel) => isPathInsideScope(rel, task.scope)),
      ]);

      if (result.providerFailure && this.config.stopOnProviderFailure) {
        const record: TaskAttemptRecord = {
          attempt: attemptNo,
          workerId: result.workerId,
          providerKind: result.providerKind,
          startedAt,
          endedAt: new Date(this.now()).toISOString(),
          summary: result.summary,
          toolCalls: result.toolCalls,
          passed: false,
          providerFailure: result.providerFailure,
        };
        attempts.push(record);
        this.finishProviderStop(task, attempts, filesChanged, this.now() - taskStarted, result.providerFailure);
        return 'stop-provider';
      }

      const acceptance = await this.runAcceptance(task);
      const attemptPassed = acceptance.every((item) => item.exitCode === 0) && !result.providerFailure && scope.rejected.length === 0;
      const record: TaskAttemptRecord = {
        attempt: attemptNo,
        workerId: result.workerId,
        providerKind: result.providerKind,
        startedAt,
        endedAt: new Date(this.now()).toISOString(),
        summary: result.summary,
        toolCalls: result.toolCalls,
        acceptance,
        passed: attemptPassed,
        providerFailure: result.providerFailure,
      };
      attempts.push(record);
      this.store.appendLog(JSON.stringify({ task: task.id, attempt: attemptNo, passed: attemptPassed, worker: result.workerId }));

      if (acceptance.some((item) => looksLikeOom(item.output))) this.guard.noteOom();
      if (attemptPassed) {
        passed = true;
        break;
      }
      const failText = acceptance
        .filter((item) => item.exitCode !== 0)
        .map((item) => item.command + '\n' + item.output)
        .join('\n') || result.summary;
      errors.push(failText);
    }

    const durationMs = this.now() - taskStarted;
    if (passed) {
      this.queue.update(task.id, 'PASS');
      this.store.putTask({
        taskId: task.id,
        title: task.title,
        status: 'PASS',
        attempts,
        filesChanged,
        durationMs,
        workerSummary: attempts[attempts.length - 1]?.summary,
      });
      this.store.writeLesson(task.id, '# ' + task.id + '\n\nPASS after ' + attempts.length + ' attempt(s).\n');
      return 'continue';
    }

    const last = attempts[attempts.length - 1];
    const fail = last?.acceptance?.find((item) => item.exitCode !== 0);
    const packet = await this.escalation.create({
      task,
      problem: errors[errors.length - 1] || 'Acceptance tests did not pass.',
      command: fail?.command,
      error: fail?.output,
      files: filesChanged,
      attempts,
      diffSummary: filesChanged.join(', ') || '(none)',
      recommended: 'Rewrite as a smaller NIGHT_SAFE task or fix locally. Cloud escalation is not required.',
    });
    const status = attempts.length >= task.maxAttempts ? 'BLOCKED' : 'FAILED_LIMIT';
    this.queue.update(task.id, status);
    this.store.putTask({
      taskId: task.id,
      title: task.title,
      status,
      attempts,
      filesChanged,
      durationMs,
      blockedReason: status === 'BLOCKED' ? 'Failed after ' + task.maxAttempts + ' attempts' : errors[errors.length - 1],
      escalationPath: packet.path,
      workerSummary: last?.summary,
    });
    this.store.addResourceNote('Cloud escalation: ' + packet.cloud.reason);
    return 'continue';
  }

  private finishProviderStop(
    task: NightTask,
    attempts: TaskAttemptRecord[],
    filesChanged: string[],
    durationMs: number,
    failure: { code: string; message: string },
  ): void {
    const reason = 'Provider failure ' + failure.code + ': ' + failure.message + '. Qwen/Codex fallback disabled. Run stopped.';
    this.queue.update(task.id, 'BLOCKED_PROVIDER');
    this.store.putTask({
      taskId: task.id,
      title: task.title,
      status: 'BLOCKED_PROVIDER',
      attempts,
      filesChanged,
      durationMs,
      blockedReason: reason,
      workerSummary: attempts[attempts.length - 1]?.summary,
    });
    this.store.addSafety({
      at: new Date(this.now()).toISOString(),
      taskId: task.id,
      kind: 'provider',
      detail: reason,
    });
    this.store.addResourceNote(reason);
    for (const remaining of this.queue.blockRemainingReady('BLOCKED_PROVIDER')) {
      this.store.putTask({
        taskId: remaining.id,
        title: remaining.title,
        status: 'BLOCKED_PROVIDER',
        attempts: [],
        filesChanged: [],
        durationMs: 0,
        blockedReason: 'Stopped after provider failure on ' + task.id + '; remaining READY tasks were not started.',
      });
    }
    this.store.current().status = 'stopped';
    this.store.current().currentTaskId = undefined;
    this.store.save();
  }

  private async runAcceptance(task: NightTask): Promise<Array<{ command: string; exitCode: number; output: string }>> {
    const results = [];
    for (const command of task.acceptanceCommands) {
      const validated = this.policy.validateCommand(command);
      if (!validated.ok) {
        results.push({ command, exitCode: 1, output: 'DENIED: ' + (isDenied(validated) ? validated.reason : 'invalid command') });
        continue;
      }
      const ran = await this.runCommand(validated.value, this.workspace.root);
      results.push({
        command,
        exitCode: ran.exitCode,
        output: [ran.stdout, ran.stderr].filter(Boolean).join('\n').slice(0, 4000),
      });
    }
    return results;
  }
}

export function buildContextPacket(task: NightTask, files: Record<string, string>, previousErrors: string[]): string {
  const extras = Object.entries(files).map(([name, body]) => '## ' + name + '\n' + body.slice(0, 4000)).join('\n\n');
  return [
    'Fresh context for this task only. Do not assume prior chat.',
    'Task id: ' + task.id,
    'Scope: ' + task.scope.join(', '),
    extras,
    previousErrors.length ? 'Latest failing output:\n' + previousErrors[previousErrors.length - 1].slice(0, 3000) : '',
  ].filter(Boolean).join('\n\n');
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

export function loadContextFiles(workspaceRoot: string): Record<string, string> {
  const names = ['AGENTS.md', 'PROJECT_CONTEXT.md', 'SESSION_STATE.md'];
  const out: Record<string, string> = {};
  for (const name of names) {
    const full = path.join(workspaceRoot, name);
    if (fs.existsSync(full)) out[name] = fs.readFileSync(full, 'utf8').slice(0, 6000);
  }
  return out;
}
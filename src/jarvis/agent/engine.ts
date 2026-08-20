import type { JarvisEventBus } from '../security/eventBus';
import { classifyFailure } from '../ops/errors';
import { mergeBudgets } from '../ops/budgets';
import type { JarvisBudgets } from '../ops/types';
import { assertAcyclic, blockedByFailedDep, readySteps } from './dag';
import { canRetry, classifyStepFailure } from './recovery';
import { WorkTaskStore, newStepId } from './store';
import { isTerminalStatus } from './transitions';
import type {
  PlanStep,
  PlanStepKind,
  WorkStepInvoker,
  WorkStepResult,
  WorkTask,
  WorkTaskOutcome,
} from './types';

export type WorkAgentOptions = {
  store?: WorkTaskStore;
  events?: JarvisEventBus;
  now?: () => number;
  invoke?: WorkStepInvoker;
  budgets?: Partial<JarvisBudgets>;
  simulated?: boolean;
};

const KIND_VISUAL: Record<PlanStepKind, string> = {
  understand: 'UNDERSTANDING',
  retrieve: 'MEMORY_RETRIEVAL',
  search: 'WORKSPACE_SEARCH',
  research: 'WEB_SEARCH',
  plan: 'PLANNING',
  permission: 'WAITING_PERMISSION',
  apply: 'EXECUTING',
  test: 'VERIFYING',
  verify: 'VERIFYING',
  reflect: 'REFLECTING',
};

export function defaultPlanFor(objective: string): PlanStep[] {
  const title = objective.trim() || 'Untitled task';
  const step = (kind: PlanStepKind, deps: string[], titleText: string, capability?: string): PlanStep => ({
    id: newStepId(kind),
    title: titleText,
    kind,
    dependencies: deps,
    status: 'pending',
    capability,
    riskLevel: kind === 'apply' ? 'MEDIUM' : 'LOW',
    verificationMethod: kind === 'verify' || kind === 'test' ? 'structured_check' : 'observation',
    retryPolicy: { maxAttempts: 2, attempted: 0 },
  });
  const understand = step('understand', [], `Understand: ${title.slice(0, 80)}`);
  const plan = step('plan', [understand.id], 'Build a structured plan');
  const apply = step('apply', [plan.id], 'Execute the next safe action');
  const verify = step('verify', [apply.id], 'Verify the outcome');
  const reflect = step('reflect', [verify.id], 'Record a structured reflection');
  return [understand, plan, apply, verify, reflect];
}

export class WorkAgent {
  public readonly store: WorkTaskStore;
  private readonly events?: JarvisEventBus;
  private readonly invoke: WorkStepInvoker;
  private readonly budgets: JarvisBudgets;
  private readonly simulated: boolean;
  private readonly controllers = new Map<string, AbortController>();

  constructor(options: WorkAgentOptions = {}) {
    this.store = options.store ?? new WorkTaskStore(options.now);
    this.events = options.events;
    this.invoke = options.invoke ?? defaultInvoker;
    this.budgets = mergeBudgets(options.budgets);
    this.simulated = Boolean(options.simulated);
  }

  public receive(objective: string, plan?: PlanStep[]): WorkTask {
    const steps = plan && plan.length > 0 ? plan : defaultPlanFor(objective);
    assertAcyclic(steps);
    if (steps.length > this.budgets.taskSteps) {
      throw Object.assign(new Error('Task exceeds the step budget.'), { reasonCode: 'BUDGET_EXCEEDED' });
    }
    const task = this.store.create({
      objective,
      plan: steps,
      retryBudget: this.budgets.retries,
      simulated: this.simulated,
    });
    this.emit(task, 'TASK_RECEIVED', `Task received: ${task.objective}`, { visualState: 'UNDERSTANDING' });
    return this.store.setStatus(task.id, 'UNDERSTANDING');
  }

  public async run(taskId: string): Promise<WorkTask> {
    let task = this.require(taskId);
    if (task.status === 'RECEIVED') task = this.store.setStatus(taskId, 'UNDERSTANDING');
    if (task.status === 'UNDERSTANDING') {
      this.emit(task, 'UNDERSTANDING', 'Understanding the objective', { visualState: 'UNDERSTANDING' });
      task = this.store.setStatus(taskId, 'PLANNING');
    }
    if (task.status === 'PLANNING') {
      assertAcyclic(task.plan);
      this.emit(task, 'PLANNING', `Planning ${task.plan.length} steps`, {
        visualState: 'PLANNING',
        progress: { current: 0, total: task.plan.length },
      });
      task = this.store.setStatus(taskId, 'READY');
    }

    const controller = new AbortController();
    this.controllers.set(taskId, controller);

    try {
      while (!isTerminalStatus(task.status)) {
        task = this.require(taskId);
        if (task.cancelRequested || controller.signal.aborted) {
          return this.finish(task, 'CANCELLED', 'cancelled', 'Task cancelled.');
        }
        if (task.status === 'PAUSED') return task;
        if (task.status === 'WAITING_PERMISSION') return task;
        if (task.status === 'READY') task = this.store.setStatus(taskId, 'EXECUTING');

        const failedDeps = blockedByFailedDep(task.plan);
        for (const step of failedDeps) {
          step.status = 'blocked';
        }
        if (failedDeps.length) {
          task = this.store.save(task);
        }

        const ready = readySteps(task.plan);
        if (ready.length === 0) {
          const pending = task.plan.filter(step => !['done', 'failed', 'cancelled', 'skipped', 'blocked'].includes(step.status));
          if (pending.length === 0) {
            task = this.store.setStatus(taskId, 'OBSERVING');
            task = this.store.setStatus(taskId, 'VERIFYING');
            return this.verify(task);
          }
          const waiting = pending.find(step => step.status === 'waiting_permission');
          if (waiting) {
            this.emit(task, 'PERMISSION_WAITING', `Waiting for permission: ${waiting.title}`, {
              visualState: 'WAITING_PERMISSION',
            });
            return this.store.setStatus(taskId, 'WAITING_PERMISSION');
          }
          return this.finish(task, 'BLOCKED', 'blocked', 'No runnable steps remain.');
        }

        const step = ready[0];
        await this.executeStep(task, step, controller.signal);
        task = this.require(taskId);
      }
      return task;
    } finally {
      this.controllers.delete(taskId);
    }
  }

  public cancel(taskId: string): WorkTask {
    const task = this.require(taskId);
    task.cancelRequested = true;
    this.controllers.get(taskId)?.abort();
    if (isTerminalStatus(task.status)) return this.store.save(task);
    this.emit(task, 'TASK_CANCELLED', 'Cancellation requested', { visualState: 'IDLE' });
    return this.finish(this.store.save(task), 'CANCELLED', 'cancelled', 'Task cancelled.');
  }

  public pause(taskId: string): WorkTask {
    const task = this.require(taskId);
    if (isTerminalStatus(task.status)) return task;
    this.controllers.get(taskId)?.abort();
    return this.store.setStatus(taskId, 'PAUSED');
  }

  public resume(taskId: string): Promise<WorkTask> {
    const task = this.require(taskId);
    if (task.status === 'PAUSED' || task.status === 'WAITING_PERMISSION') {
      this.store.setStatus(taskId, 'READY');
    }
    return this.run(taskId);
  }

  public grantPermission(taskId: string, stepId?: string): WorkTask {
    const task = this.require(taskId);
    for (const step of task.plan) {
      if (step.status === 'waiting_permission' && (!stepId || step.id === stepId)) {
        step.status = 'done';
        step.resultSummary = 'Owner granted permission for this task.';
      }
    }
    const next = this.store.save({ ...task, status: task.status === 'WAITING_PERMISSION' ? 'READY' : task.status });
    this.emit(next, 'PRIVILEGE_APPROVED', 'Owner granted task permission', { visualState: 'EXECUTING' });
    return next;
  }

  private async executeStep(task: WorkTask, step: PlanStep, signal: AbortSignal): Promise<void> {
    step.status = 'running';
    step.retryPolicy.attempted += 1;
    this.store.save(task);
    this.emit(task, 'TASK_STEP', step.title, {
      visualState: KIND_VISUAL[step.kind],
      progress: {
        current: task.plan.filter(item => item.status === 'done').length,
        total: task.plan.length,
      },
    }, { stepId: step.id, kind: step.kind });

    let result: WorkStepResult;
    try {
      if (signal.aborted) {
        return;
      }
      result = await this.invoke(task, step, signal);
    } catch (error) {
      if (signal.aborted || this.require(task.id).cancelRequested || isTerminalStatus(this.require(task.id).status)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      result = {
        ok: false,
        summary: message,
        errorCode: classifyFailure({ message, reasonCode: (error as { reasonCode?: string }).reasonCode }),
      };
    }

    const latest = this.require(task.id);
    if (latest.cancelRequested || isTerminalStatus(latest.status) || signal.aborted) {
      return;
    }
    task.status = latest.status;
    task.cancelRequested = latest.cancelRequested;
    task.retriesUsed = latest.retriesUsed;
    task.errors = latest.errors;
    task.plan = latest.plan.map(item => item.id === step.id ? step : item);

    if (result.permissionRequired) {
      step.status = 'waiting_permission';
      task.permissionRequirements = unique([...task.permissionRequirements, step.capability || step.id]);
      this.store.save(task);
      this.emit(task, 'PERMISSION_WAITING', result.summary, { visualState: 'WAITING_PERMISSION' });
      this.store.setStatus(task.id, 'WAITING_PERMISSION');
      return;
    }

    if (result.ok || result.skipped) {
      step.status = result.skipped ? 'skipped' : 'done';
      step.resultSummary = result.summary;
      if (result.toolResult) task.toolResults.push(result.toolResult);
      if (result.evidence) task.evidence.push(...result.evidence);
      this.store.save(task);
      return;
    }

    const code = result.errorCode || classifyStepFailure(step, result.summary);
    step.errorCode = code;
    step.resultSummary = result.summary;
    task.errors.push({ at: new Date().toISOString(), code, message: result.summary, stepId: step.id });

    if (canRetry(step, task, code)) {
      task.retriesUsed += 1;
      step.status = 'retrying';
      this.store.save(task);
      this.emit(task, 'TASK_RETRY', `Retrying ${step.title}`, { visualState: 'EXECUTING', errorCode: code });
      this.store.setStatus(task.id, 'ADAPTING');
      this.store.setStatus(task.id, 'READY');
      return;
    }

    step.status = 'failed';
    this.store.save(task);
    this.finish(task, 'FAILED', 'failure', result.summary, code);
  }

  private verify(task: WorkTask): WorkTask {
    const failed = task.plan.some(step => step.status === 'failed');
    const blocked = task.plan.some(step => step.status === 'blocked' || step.status === 'waiting_permission');
    if (failed) {
      return this.finish(task, 'FAILED', 'failure', 'Verification failed because a step failed.');
    }
    if (blocked) {
      return this.finish(task, 'BLOCKED', 'blocked', 'Verification blocked on incomplete steps.');
    }
    const verified: WorkTask = {
      ...task,
      verification: { passed: true, summary: 'All planned steps completed.' },
    };
    this.store.save(verified);
    return this.finish(verified, 'COMPLETED', 'success', 'Task completed.');
  }

  private finish(task: WorkTask, status: WorkTask['status'], outcome: WorkTaskOutcome, summary: string, errorCode?: string): WorkTask {
    const current = this.require(task.id);
    if (isTerminalStatus(current.status) && current.status !== status) {
      return current;
    }
    if (status === 'FAILED') {
      this.emit(task, 'TASK_FAILED', summary, { visualState: 'ERROR', errorCode: errorCode || 'STEP_FAILED' });
    } else if (status === 'CANCELLED') {
      this.emit(task, 'TASK_CANCELLED', summary, { visualState: 'IDLE' });
    } else if (status === 'BLOCKED') {
      this.emit(task, 'TASK_BLOCKED', summary, { visualState: 'WAITING_PERMISSION' });
    } else {
      this.emit(task, 'TASK_COMPLETED', summary, { visualState: 'RESPONDING' });
    }
    const next: WorkTask = {
      ...this.require(task.id),
      status,
      outcome,
    };
    return this.store.save(next);
  }

  private require(id: string): WorkTask {
    const task = this.store.get(id);
    if (!task) throw Object.assign(new Error('Unknown work task.'), { reasonCode: 'PLAN_INVALID' });
    return task;
  }

  private emit(
    task: WorkTask,
    type: Parameters<JarvisEventBus['emit']>[0],
    summary: string,
    meta: { visualState?: string; progress?: { current: number; total: number }; errorCode?: string } = {},
    payload: Record<string, unknown> = {},
  ): void {
    this.events?.emit(type, summary, { taskId: task.id, objective: task.objective, ...payload }, meta.errorCode ? 'error' : 'info', {
      taskId: task.id,
      visualState: meta.visualState,
      progress: meta.progress,
      simulated: task.simulated || this.simulated,
      errorCode: meta.errorCode,
    });
  }
}

async function defaultInvoker(task: WorkTask, step: PlanStep, signal: AbortSignal): Promise<WorkStepResult> {
  if (signal.aborted) {
    return { ok: false, summary: 'Cancelled.', errorCode: 'CANCELLED' };
  }
  if (step.kind === 'permission') {
    return { ok: false, summary: `Capability ${step.capability || step.id} requires owner permission.`, permissionRequired: true, errorCode: 'PERMISSION_REQUIRED' };
  }
  return {
    ok: true,
    summary: `${step.title} completed${task.simulated ? ' (simulation)' : ''}.`,
    skipped: step.kind === 'apply' && !step.capability,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

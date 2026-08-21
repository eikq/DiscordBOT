import type { JarvisEventBus } from '../security/eventBus';
import { classifyFailure } from '../ops/errors';
import { mergeBudgets } from '../ops/budgets';
import type { JarvisBudgets } from '../ops/types';
import { assertAcyclic, blockedByFailedDep, readySteps } from './dag';
import { canRetry, classifyStepFailure } from './recovery';
import { WorkTaskStore } from './store';
import { isTerminalStatus } from './transitions';
import type {
  PermissionGrantInput,
  PlanStep,
  PlanStepKind,
  WorkStepInvoker,
  WorkStepResult,
  WorkTask,
  WorkTaskOutcome,
} from './types';
import { defaultPlanFor } from './plans';
import { denyPermissionStep, markLeaseUsed, PermissionDeniedError, validatePermissionGrant, waitingPermissionStep } from './permission';
import type { EmergencyStopController } from '../security/emergencyStop';

export { defaultPlanFor, planForObjective } from './plans';

export type WorkAgentOptions = {
  store?: WorkTaskStore;
  events?: JarvisEventBus;
  now?: () => number;
  invoke?: WorkStepInvoker;
  budgets?: Partial<JarvisBudgets>;
  simulated?: boolean;
  onTerminal?: (task: WorkTask) => void;
  emergency?: EmergencyStopController;
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

export class WorkAgent {
  public readonly store: WorkTaskStore;
  private readonly events?: JarvisEventBus;
  private readonly invoke: WorkStepInvoker;
  private readonly budgets: JarvisBudgets;
  private readonly simulated: boolean;
  private readonly onTerminal?: (task: WorkTask) => void;
  private readonly controllers = new Map<string, AbortController>();
  private readonly ownerTokens = new Map<string, {
    token: string;
    taskId: string;
    stepId: string;
    capability: string;
    expiresAt?: number;
  }>();
  private readonly usedTokenHashes = new Set<string>();
  private readonly emergency?: EmergencyStopController;

  constructor(options: WorkAgentOptions = {}) {
    this.store = options.store ?? new WorkTaskStore(options.now);
    this.events = options.events;
    this.invoke = options.invoke ?? defaultInvoker;
    this.budgets = mergeBudgets(options.budgets);
    this.simulated = Boolean(options.simulated);
    this.onTerminal = options.onTerminal;
    this.emergency = options.emergency;
    this.emergency?.register({
      id: 'work-agent',
      cancelForEmergency: () => this.cancelForEmergency(),
    });
  }

  public receive(objective: string, plan?: PlanStep[], extra: { simulated?: boolean } = {}): WorkTask {
    this.assertEmergencyAllowsExecution();
    const steps = plan && plan.length > 0 ? plan : defaultPlanFor(objective);
    assertAcyclic(steps);
    if (steps.length > this.budgets.taskSteps) {
      throw Object.assign(new Error('Task exceeds the step budget.'), { reasonCode: 'BUDGET_EXCEEDED' });
    }
    const task = this.store.create({
      objective,
      plan: steps,
      retryBudget: this.budgets.retries,
      simulated: extra.simulated ?? this.simulated,
    });
    this.emit(task, 'TASK_RECEIVED', `Task received: ${task.objective}`, { visualState: 'UNDERSTANDING' });
    return this.store.setStatus(task.id, 'UNDERSTANDING');
  }

  public async run(taskId: string): Promise<WorkTask> {
    let task = this.require(taskId);
    if (this.emergency && !this.emergency.allows('system', 'write')) {
      return this.finish(task, 'CANCELLED', 'cancelled', 'Emergency Stop is active.');
    }
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
    this.assertEmergencyAllowsExecution();
    const task = this.require(taskId);
    if (task.status === 'PAUSED' || task.status === 'WAITING_PERMISSION') {
      this.store.setStatus(taskId, 'READY');
    }
    return this.run(taskId);
  }

  public grantPermission(taskId: string, stepIdOrGrant?: string | PermissionGrantInput): WorkTask {
    this.assertEmergencyAllowsExecution();
    const grant: PermissionGrantInput = typeof stepIdOrGrant === 'string'
      ? { actor: 'owner', stepId: stepIdOrGrant }
      : { actor: 'owner', ...stepIdOrGrant };
    const task = this.require(taskId);
    const step = waitingPermissionStep(task, grant.stepId);
    if (!step) {
      throw Object.assign(new Error('No step is waiting for permission.'), { reasonCode: 'PERMISSION_REQUIRED' });
    }
    const cached = step.pendingConfirmation?.proposalId
      ? this.ownerTokens.get(step.pendingConfirmation.proposalId)
      : undefined;
    if (!grant.token && cached && cached.taskId === task.id && cached.stepId === step.id) {
      grant.token = cached.token;
      grant.proposalId = grant.proposalId || step.pendingConfirmation?.proposalId;
    }
    let validated;
    try {
      validated = validatePermissionGrant(task, step, { ...grant, taskId }, Date.now());
    } catch (error) {
      if (error instanceof PermissionDeniedError) {
        throw Object.assign(new Error(error.message), { reasonCode: error.reasonCode });
      }
      throw error;
    }
    if (validated.lease.tokenHash && this.usedTokenHashes.has(`${task.id}:${validated.lease.tokenHash}`)) {
      throw Object.assign(new Error('That permission token was already used.'), { reasonCode: 'CONFIRMATION_REUSED' });
    }
    step.permissionLease = {
      ...validated.lease,
      token: validated.token,
    };
    step.status = 'pending';
    step.resultSummary = 'Owner granted a scoped lease; the same step will resume through CapabilityHost.';
    const next = this.store.save({
      ...task,
      status: task.status === 'WAITING_PERMISSION' ? 'READY' : task.status,
    });
    this.emit(next, 'PRIVILEGE_APPROVED', 'Owner granted a scoped task permission', { visualState: 'EXECUTING' });
    return next;
  }

  public denyPermission(taskId: string, stepId?: string): WorkTask {
    const task = this.require(taskId);
    const step = waitingPermissionStep(task, stepId);
    if (!step) {
      throw Object.assign(new Error('No step is waiting for permission.'), { reasonCode: 'PERMISSION_REQUIRED' });
    }
    const denied = denyPermissionStep(step);
    Object.assign(step, denied);
    this.emit(task, 'PRIVILEGE_DENIED', 'Owner denied task permission', { visualState: 'WAITING_PERMISSION' });
    return this.finish(this.store.save(task), 'BLOCKED', 'blocked', 'Owner denied permission.');
  }

  private cancelForEmergency() {
    this.ownerTokens.clear();
    return this.store.active().map(task => {
      const wasRunning = this.controllers.has(task.id);
      this.cancel(task.id);
      return {
        ownerId: 'work-agent',
        workId: task.id,
        state: wasRunning ? 'CANCELLATION_REQUESTED' as const : 'CANCELLED' as const,
        detail: wasRunning
          ? 'Task cancellation was requested; an already-running capability may not expose cancellation.'
          : 'Queued or waiting task was cancelled before further execution.',
      };
    });
  }

  private assertEmergencyAllowsExecution(): void {
    if (this.emergency && !this.emergency.allows('system', 'write')) {
      throw Object.assign(new Error('Emergency Stop is active. Only the owner can resume operation.'), {
        reasonCode: 'EMERGENCY_STOP_ACTIVE',
      });
    }
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
    step.preflight = result.preflight;
    step.verification = result.verification;
    step.rollback = result.rollback;
    if (result.rollback) {
      task.rollback = result.rollback;
      task.rollbackInfo = `${result.rollback.state}: ${result.rollback.strategy}`;
    }

    if (result.permissionRequired) {
      step.status = 'waiting_permission';
      step.pendingConfirmation = result.pendingConfirmation;
      task.permissionRequirements = unique([
        ...task.permissionRequirements,
        result.pendingConfirmation?.capability || step.capability || step.id,
      ]);
      if (result.confirmToken && result.pendingConfirmation?.proposalId) {
        this.ownerTokens.set(result.pendingConfirmation.proposalId, {
          token: result.confirmToken,
          taskId: task.id,
          stepId: step.id,
          capability: result.pendingConfirmation.capability,
          expiresAt: result.pendingConfirmation.expiresAt
            ? Date.parse(result.pendingConfirmation.expiresAt)
            : undefined,
        });
      }
      this.store.save(task);
      this.emit(task, 'PERMISSION_WAITING', result.summary, { visualState: 'WAITING_PERMISSION' });
      this.store.setStatus(task.id, 'WAITING_PERMISSION');
      return;
    }

    if (result.ok || result.skipped) {
      if (step.permissionLease?.tokenHash) {
        this.usedTokenHashes.add(`${task.id}:${step.permissionLease.tokenHash}`);
        markLeaseUsed(step);
      }
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
    this.emit(task, 'VERIFICATION_STARTED', 'Task outcome verification started', { visualState: 'VERIFYING' });
    const failed = task.plan.some(step => step.status === 'failed');
    const blocked = task.plan.some(step => step.status === 'blocked' || step.status === 'waiting_permission');
    if (failed) {
      this.emit(task, 'VERIFICATION_COMPLETED', 'Verification failed because a step failed', { visualState: 'ERROR', errorCode: 'VERIFICATION_FAILED' });
      return this.finish(task, 'FAILED', 'failure', 'Verification failed because a step failed.');
    }
    if (blocked) {
      this.emit(task, 'VERIFICATION_COMPLETED', 'Verification blocked on incomplete steps', { visualState: 'WAITING_PERMISSION' });
      return this.finish(task, 'BLOCKED', 'blocked', 'Verification blocked on incomplete steps.');
    }
    const verificationRecords = task.plan.flatMap(step => step.verification ? [step.verification] : []);
    const failedVerification = verificationRecords.filter(item => item.state === 'FAILED_VERIFICATION');
    const mutationSteps = task.plan.filter(step => step.preflight?.effects.some(effect => effect.kind !== 'READ'));
    const incompleteVerification = mutationSteps.filter(step => !step.verification
      || step.verification.state === 'UNVERIFIED'
      || step.verification.state === 'PARTIALLY_VERIFIED');
    if (failedVerification.length > 0) {
      const failedTask: WorkTask = {
        ...task,
        verification: {
          passed: false,
          state: 'FAILED_VERIFICATION',
          summary: 'One or more registered postconditions failed.',
          evidence: verificationRecords.flatMap(item => item.evidence),
          failedChecks: failedVerification.flatMap(item => item.failedChecks),
        },
      };
      this.store.save(failedTask);
      this.emit(failedTask, 'VERIFICATION_COMPLETED', failedTask.verification!.summary, { visualState: 'ERROR', errorCode: 'VERIFICATION_FAILED' });
      return this.finish(failedTask, 'FAILED', 'failure', 'Task postcondition verification failed.', 'VERIFICATION_FAILED');
    }
    if (incompleteVerification.length > 0) {
      const partialTask: WorkTask = {
        ...task,
        verification: {
          passed: false,
          state: verificationRecords.some(item => item.state === 'PARTIALLY_VERIFIED')
            ? 'PARTIALLY_VERIFIED'
            : 'UNVERIFIED',
          summary: 'Execution completed, but independent postconditions did not fully verify every mutation.',
          evidence: verificationRecords.flatMap(item => item.evidence),
          failedChecks: [],
        },
      };
      this.store.save(partialTask);
      this.emit(partialTask, 'VERIFICATION_COMPLETED', partialTask.verification!.summary, { visualState: 'DEGRADED' });
      return this.finish(partialTask, 'DEGRADED', 'degraded', partialTask.verification!.summary);
    }
    const verified: WorkTask = {
      ...task,
      verification: {
        passed: true,
        state: verificationRecords.some(item => item.state === 'VERIFIED') ? 'VERIFIED' : 'NOT_APPLICABLE',
        summary: verificationRecords.some(item => item.state === 'VERIFIED')
          ? 'All registered mutation postconditions passed.'
          : 'No mutation postcondition was applicable.',
        evidence: verificationRecords.flatMap(item => item.evidence),
        failedChecks: [],
      },
    };
    this.store.save(verified);
    this.emit(verified, 'VERIFICATION_COMPLETED', verified.verification!.summary, { visualState: 'RESPONDING' });
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
    } else if (status === 'DEGRADED') {
      this.emit(task, 'TASK_COMPLETED', summary, { visualState: 'DEGRADED' });
    } else {
      this.emit(task, 'TASK_COMPLETED', summary, { visualState: 'RESPONDING' });
    }
    const next: WorkTask = {
      ...this.require(task.id),
      status,
      outcome,
    };
    const saved = this.store.save(next);
    try {
      this.onTerminal?.(saved);
    } catch {
      // Evolution/recording failures must not mutate the terminal task outcome.
    }
    return saved;
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
    if (step.permissionLease && !step.permissionLease.used && !step.permissionLease.denied) {
      return { ok: true, summary: 'Owner permission lease accepted for this planning gate.' };
    }
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

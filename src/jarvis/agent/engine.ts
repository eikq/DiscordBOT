import type { JarvisEventBus } from '../security/eventBus';
import { classifyFailure } from '../ops/errors';
import { mergeBudgets } from '../ops/budgets';
import type { JarvisBudgets } from '../ops/types';
import { assertAcyclic, blockedByFailedDep, readySteps } from './dag';
import { canRetry, classifyStepFailure } from './recovery';
import { newStepId, WorkTaskStore } from './store';
import { isTerminalStatus } from './transitions';
import type {
  PermissionGrantInput,
  PlanStep,
  PlanStepKind,
  WorkStepInvoker,
  WorkStepResult,
  WorkGapResolver,
  WorkTask,
  WorkTaskOutcome,
} from './types';
import { defaultPlanFor } from './plans';
import { denyPermissionStep, markLeaseUsed, PermissionDeniedError, validatePermissionGrant, waitingPermissionStep } from './permission';
import type { EmergencyStopController } from '../security/emergencyStop';
import { createAbortReason, readAbortReason } from '../capabilities/cancellation';
import type { CapabilityCancellationReason, CapabilityCancellationRecord } from '../capabilities/types';

export { defaultPlanFor, planForObjective, planForGoalResolution } from './plans';

export type WorkAgentOptions = {
  store?: WorkTaskStore;
  events?: JarvisEventBus;
  now?: () => number;
  invoke?: WorkStepInvoker;
  budgets?: Partial<JarvisBudgets>;
  simulated?: boolean;
  onTerminal?: (task: WorkTask) => void;
  emergency?: EmergencyStopController;
  resolveGap?: WorkGapResolver;
  maxGapReplans?: number;
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
  private readonly resolveGap?: WorkGapResolver;
  private readonly maxGapReplans: number;

  constructor(options: WorkAgentOptions = {}) {
    this.store = options.store ?? new WorkTaskStore(options.now);
    this.events = options.events;
    this.invoke = options.invoke ?? defaultInvoker;
    this.budgets = mergeBudgets(options.budgets);
    this.simulated = Boolean(options.simulated);
    this.onTerminal = options.onTerminal;
    this.emergency = options.emergency;
    this.resolveGap = options.resolveGap;
    this.maxGapReplans = Math.max(1, Math.min(options.maxGapReplans ?? 2, 4));
    this.emergency?.register({
      id: 'work-agent',
      cancelForEmergency: () => this.cancelForEmergency(),
    });
  }

  public receive(objective: string, plan?: PlanStep[], extra: { simulated?: boolean; goalResolution?: import('../goals/types').GoalResolution } = {}): WorkTask {
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
      maxGapReplans: this.maxGapReplans,
      simulated: extra.simulated ?? this.simulated,
      goalResolution: extra.goalResolution,
    });
    this.emit(task, 'TASK_RECEIVED', `Task received: ${task.objective}`, { visualState: 'UNDERSTANDING' });
    return this.store.setStatus(task.id, 'UNDERSTANDING');
  }

  public receiveWaitingInput(input: {
    objective: string;
    pendingGoalId: string;
    question: string;
    missingFields: string[];
    expiresAt: string;
    goalResolution: import('../goals/types').GoalResolution;
    simulated?: boolean;
  }): WorkTask {
    const task = this.store.create({
      objective: input.objective,
      plan: [{
        id: newStepId('understand'),
        title: 'Understand the declared owner goal',
        kind: 'understand',
        dependencies: [],
        status: 'done',
        riskLevel: 'LOW',
        verificationMethod: 'GoalCatalog identity and required-input evidence',
        retryPolicy: { maxAttempts: 0, attempted: 0 },
        resultSummary: 'The declared goal is valid and is waiting only for owner input.',
      }],
      retryBudget: this.budgets.retries,
      maxGapReplans: this.maxGapReplans,
      simulated: input.simulated ?? this.simulated,
      goalResolution: input.goalResolution,
      waitingInput: {
        pendingGoalId: input.pendingGoalId,
        question: input.question,
        missingFields: [...input.missingFields],
        expiresAt: input.expiresAt,
        state: 'WAITING_OWNER_INPUT',
      },
    });
    this.emit(task, 'TASK_RECEIVED', `Task received: ${task.objective}`, { visualState: 'UNDERSTANDING' });
    const understanding = this.store.setStatus(task.id, 'UNDERSTANDING');
    return this.store.setStatus(understanding.id, 'WAITING_INPUT');
  }

  public updateWaitingInput(taskId: string, input: {
    question: string;
    missingFields: string[];
    expiresAt: string;
    goalResolution: import('../goals/types').GoalResolution;
  }): WorkTask {
    const task = this.require(taskId);
    if (task.status !== 'WAITING_INPUT') return task;
    task.goalResolution = structuredClone(input.goalResolution);
    task.waitingInput = {
      pendingGoalId: task.waitingInput?.pendingGoalId || '',
      question: input.question,
      missingFields: [...input.missingFields],
      expiresAt: input.expiresAt,
      state: 'WAITING_OWNER_INPUT',
    };
    return this.store.save(task);
  }

  public resumeWaitingInput(taskId: string, plan: PlanStep[], goalResolution: import('../goals/types').GoalResolution): Promise<WorkTask> {
    this.assertEmergencyAllowsExecution();
    const task = this.require(taskId);
    if (task.status !== 'WAITING_INPUT') return Promise.resolve(task);
    assertAcyclic(plan);
    if (plan.length > this.budgets.taskSteps) {
      throw Object.assign(new Error('Resumed goal exceeds the step budget.'), { reasonCode: 'BUDGET_EXCEEDED' });
    }
    task.plan = plan.map((step, index) => ({
      ...step,
      status: index === 0 && step.kind === 'understand' ? 'done' as const : step.status,
      ...(index === 0 && step.kind === 'understand' ? { resultSummary: 'Goal identity and continuation input were revalidated.' } : {}),
    }));
    task.goalResolution = structuredClone(goalResolution);
    task.waitingInput = undefined;
    task.evidence = [...task.evidence, 'pending-goal:resumed-with-current-runtime-evidence'];
    task.status = 'PLANNING';
    this.store.save(task);
    return this.run(taskId);
  }

  public expireWaitingInput(taskId: string): WorkTask {
    const task = this.require(taskId);
    if (task.status !== 'WAITING_INPUT') return task;
    if (task.waitingInput) task.waitingInput.state = 'EXPIRED';
    task.status = 'EXPIRED';
    return this.store.save(task);
  }

  public async run(taskId: string): Promise<WorkTask> {
    let task = this.require(taskId);
    if (this.emergency && !this.emergency.allows('system', 'write')) {
      return this.finish(task, 'CANCELLED', 'cancelled', 'Emergency Stop is active.');
    }
    if (task.status === 'WAITING_INPUT') return task;
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

  public cancel(taskId: string, reason: CapabilityCancellationReason = 'OWNER_CANCEL'): WorkTask {
    const task = this.require(taskId);
    if (isTerminalStatus(task.status)) return task;
    task.cancelRequested = true;
    const controller = this.controllers.get(taskId);
    task.cancellation = {
      support: controller ? 'cooperative' : 'not_supported',
      state: controller ? 'CANCELLATION_REQUESTED' : 'CANCELLED',
      reason,
      requestedAt: new Date().toISOString(),
      ...(controller ? {} : { completedAt: new Date().toISOString() }),
      observedByHandler: false,
      detail: controller
        ? 'Cancellation reached the running capability path; handler acknowledgement is pending.'
        : 'Task was cancelled before a typed capability was running.',
    };
    const saved = this.store.save(task);
    this.events?.emit('ACTION_CANCEL_REQUESTED', task.cancellation.detail, {
      taskId,
      reason,
      state: task.cancellation.state,
    }, 'warn', { taskId });
    if (controller) {
      controller.abort(createAbortReason(reason));
      return saved;
    }
    return this.finish(saved, 'CANCELLED', 'cancelled', 'Task cancelled before execution.');
  }

  public pause(taskId: string): WorkTask {
    const task = this.require(taskId);
    if (isTerminalStatus(task.status)) return task;
    this.controllers.get(taskId)?.abort(createAbortReason('OWNER_CANCEL'));
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
      this.cancel(task.id, 'EMERGENCY_STOP');
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
        result = {
          ok: false,
          summary: 'The running step ended after cancellation, without a typed handler acknowledgement.',
          errorCode: 'CANCELLED',
          cancellation: cancellationAfterInvocation(undefined, signal, false),
        };
      } else {
        const message = error instanceof Error ? error.message : String(error);
        result = {
          ok: false,
          summary: message,
          errorCode: classifyFailure({ message, reasonCode: (error as { reasonCode?: string }).reasonCode }),
        };
      }
    }

    const latest = this.require(task.id);
    if (isTerminalStatus(latest.status)) return;
    if ((latest.cancelRequested || signal.aborted) && latest.status !== 'PAUSED') {
      const cancellation = cancellationAfterInvocation(result.cancellation, signal, result.ok);
      step.preflight = result.preflight;
      step.verification = result.verification;
      step.rollback = result.rollback;
      step.cancellation = cancellation;
      step.status = cancellation.state === 'COMPLETED_BEFORE_CANCEL' ? 'done' : 'cancelled';
      step.resultSummary = cancellation.detail;
      const cancelledTask: WorkTask = {
        ...latest,
        plan: latest.plan.map(item => item.id === step.id ? step : item),
        cancellation,
        ...(result.rollback ? {
          rollback: result.rollback,
          rollbackInfo: `${result.rollback.state}: ${result.rollback.strategy}`,
        } : {}),
      };
      this.store.save(cancelledTask);
      this.events?.emit(
        cancellation.state === 'CANCELLED' ? 'ACTION_CANCELLED' : 'ACTION_CANCEL_FAILED',
        cancellation.detail,
        { taskId: task.id, stepId: step.id, state: cancellation.state, reason: cancellation.reason },
        cancellation.state === 'CANCELLED' ? 'warn' : 'error',
        { taskId: task.id },
      );
      this.emergency?.recordCancellationResult({
        ownerId: 'work-agent',
        workId: task.id,
        state: emergencyStateForCancellation(cancellation.state),
        detail: cancellation.detail,
      });
      this.finish(cancelledTask, 'CANCELLED', 'cancelled', cancellation.detail);
      return;
    }
    if (signal.aborted) return;
    task.status = latest.status;
    task.cancelRequested = latest.cancelRequested;
    task.retriesUsed = latest.retriesUsed;
    task.errors = latest.errors;
    task.plan = latest.plan.map(item => item.id === step.id ? step : item);
    step.preflight = result.preflight;
    step.verification = result.verification;
    step.rollback = result.rollback;
    step.cancellation = result.cancellation;
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

    const gapEligible = result.errorCode === 'PLAN_INVALID'
      || result.errorCode === 'PROVIDER_UNAVAILABLE'
      || result.errorCode === 'LOCAL_ACCEPTANCE_REQUIRED'
      || result.errorCode === 'SIMULATION_ONLY';
    const gapResolution = result.gapResolution ?? (gapEligible
      ? await this.resolveGap?.(
          task,
          step,
          result,
          task.goalPursuit?.attempted ?? 0,
          task.goalPursuit?.maximum ?? this.maxGapReplans,
        )
      : undefined);
    if (gapResolution) {
      if (result.toolResult) task.toolResults.push(result.toolResult);
      task.gapResolution = gapResolution;
      task.blockers = gapResolution.missing.map(item => ({
        capabilityId: item.capabilityId,
        blocker: item.blocker,
        reason: item.reason,
      }));
      this.events?.emit('CAPABILITY_GAP_DETECTED', 'Capability gap classified before abandoning the owner goal.', {
        taskId: task.id,
        stepId: step.id,
        blockers: task.blockers.map(item => ({ capabilityId: item.capabilityId, blocker: item.blocker })),
      }, 'warn', { taskId: task.id });
      if (this.applySafeGapReplan(task, step, gapResolution)) {
        this.store.save(task);
        this.events?.emit('GOAL_REPLANNED', gapResolution.recommendedPath!.title, {
          taskId: task.id,
          stepId: step.id,
          capabilityIds: gapResolution.recommendedPath!.capabilityIds,
          attempted: task.goalPursuit?.attempted,
          maximum: task.goalPursuit?.maximum,
        }, 'info', { taskId: task.id });
        this.store.setStatus(task.id, 'ADAPTING');
        this.store.setStatus(task.id, 'READY');
        return;
      }
      step.status = 'blocked';
      step.resultSummary = gapResolution.recommendedPath?.title || result.summary;
      task.errors.push({
        at: new Date().toISOString(),
        code: result.errorCode || 'PLAN_INVALID',
        message: result.summary,
        stepId: step.id,
      });
      this.store.save(task);
      this.finish(
        task,
        'BLOCKED',
        'blocked',
        gapResolution.recommendedPath?.title || 'No safe executable capability path is currently available.',
        result.errorCode || 'PLAN_INVALID',
      );
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

  private applySafeGapReplan(
    task: WorkTask,
    step: PlanStep,
    resolution: import('../intelligence/types').GapResolutionPlan,
  ): boolean {
    const pursuit = task.goalPursuit ?? { attempted: 0, maximum: this.maxGapReplans };
    const path = resolution.recommendedPath;
    if (!path?.executableNow || !path.inputCompatible || pursuit.attempted >= pursuit.maximum) return false;
    if (path.kind !== 'USE_EXISTING_CAPABILITY' && path.kind !== 'COMPOSE_EXISTING_CAPABILITIES') return false;
    const ids = [...new Set(path.capabilityIds.filter(Boolean))];
    if (ids.length === 0 || (ids.length === 1 && ids[0] === step.capability)) return false;
    if (task.plan.length + Math.max(0, ids.length - 1) > this.budgets.taskSteps) return false;

    pursuit.attempted += 1;
    task.goalPursuit = pursuit;
    const originalId = step.id;
    const index = task.plan.findIndex(item => item.id === originalId);
    if (index < 0) return false;
    const goalRoute = task.goalResolution?.routes.find(route => (
      route.steps.map(item => item.capabilityId).join('\u0000') === ids.join('\u0000')
    ));
    step.capability = ids[0];
    const firstResolved = goalRoute?.steps[0];
    step.input = firstResolved ? structuredClone(firstResolved.input) : step.input;
    step.inputAdapter = firstResolved?.adapterId ? {
      id: firstResolved.adapterId,
      compatibility: 'ADAPTER_COMPATIBLE',
      evidence: [...firstResolved.evidence],
    } : undefined;
    step.status = 'pending';
    step.errorCode = undefined;
    step.resultSummary = `Replanned to ${ids[0]} from structured registry evidence.`;
    step.retryPolicy = { ...step.retryPolicy, attempted: 0 };
    let previousId = originalId;
    const inserted: PlanStep[] = [];
    for (const [offset, capabilityId] of ids.slice(1).entries()) {
      const resolved = goalRoute?.steps[offset + 1];
      const next: PlanStep = {
        ...step,
        id: newGapStepId(capabilityId, pursuit.attempted, inserted.length),
        title: `Invoke ${capabilityId} (safe composed path)`,
        dependencies: [previousId],
        status: 'pending',
        capability: capabilityId,
        input: resolved ? structuredClone(resolved.input) : step.input,
        inputAdapter: resolved?.adapterId ? {
          id: resolved.adapterId,
          compatibility: 'ADAPTER_COMPATIBLE',
          evidence: [...resolved.evidence],
        } : undefined,
        retryPolicy: { ...step.retryPolicy, attempted: 0 },
      };
      inserted.push(next);
      previousId = next.id;
    }
    if (goalRoute && task.goalResolution) {
      task.goalResolution.selectedRouteId = goalRoute.id;
      task.goalResolution.boundedAttempts.attempted = pursuit.attempted;
      task.goalResolution.evidence.push(`replan:${goalRoute.id}:${pursuit.attempted}`);
    }
    task.plan.splice(index + 1, 0, ...inserted);
    if (inserted.length > 0) {
      const insertedIds = new Set(inserted.map(item => item.id));
      for (const item of task.plan) {
        if (item.id === originalId || insertedIds.has(item.id)) continue;
        item.dependencies = item.dependencies.map(dependency => dependency === originalId ? previousId : dependency);
      }
    }
    assertAcyclic(task.plan);
    return true;
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
      ...(task.goalResolution?.goalId ? {
        goalOutcome: {
          goalId: task.goalResolution.goalId,
          outcome: outcome === 'success' ? 'success' : outcome === 'degraded' || outcome === 'cancelled' ? 'partial' : 'failure',
          verificationState: task.verification?.state,
          capabilityOutcomes: task.toolResults.map(item => ({ capabilityId: item.capability, status: item.status })),
          evidenceRefs: unique([
            `goal:${task.goalResolution.goalId}`,
            ...task.goalResolution.evidence.slice(0, 6),
            ...task.evidence.slice(0, 8),
          ]),
        },
      } : {}),
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

function newGapStepId(capabilityId: string, attempt: number, offset: number): string {
  const safe = capabilityId.toLowerCase().replace(/[^a-z0-9]+/gu, '_').slice(0, 24) || 'capability';
  return `gap_${safe}_${attempt}_${offset}`;
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

function cancellationAfterInvocation(
  record: CapabilityCancellationRecord | undefined,
  signal: AbortSignal,
  completedSuccessfully: boolean,
): CapabilityCancellationRecord {
  if (record) return record;
  const reason = readAbortReason(signal) ?? createAbortReason('OWNER_CANCEL');
  return {
    support: 'not_supported',
    state: completedSuccessfully ? 'COMPLETED_BEFORE_CANCEL' : 'FAILED_TO_CANCEL',
    reason: reason.reason,
    requestedAt: reason.requestedAt,
    completedAt: new Date().toISOString(),
    observedByHandler: false,
    detail: completedSuccessfully
      ? 'The step completed after cancellation was requested; no further task step will run.'
      : 'The running step ended without a handler cancellation acknowledgement.',
  };
}

function emergencyStateForCancellation(
  state: CapabilityCancellationRecord['state'],
): import('../security/emergencyStop').EmergencyCancellationState {
  if (state === 'CANCELLED') return 'CANCELLED';
  if (state === 'COMPLETED_BEFORE_CANCEL') return 'COMPLETED_BEFORE_CANCEL';
  if (state === 'FAILED_TO_CANCEL') return 'FAILED_TO_CANCEL';
  if (state === 'NOT_CANCELLABLE') return 'NOT_CANCELLABLE';
  return 'CANCELLATION_REQUESTED';
}

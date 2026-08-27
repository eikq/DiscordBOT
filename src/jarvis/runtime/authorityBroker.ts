import type { EmergencyStopController } from '../security/emergencyStop';
import type { AgentRuntimeBinding } from './binding';
import { AgentRuntimeBindingCoordinator } from './binding';
import type { AgentRuntime, ApprovalDecision } from './types';

export type RuntimeControlActor = 'owner' | 'system' | 'jarvis' | 'model';

export type RuntimeControlContext = {
  actor: RuntimeControlActor;
  jarvisSessionId: string;
  goalId?: string;
  pendingGoalId?: string;
  taskId?: string;
};

export type RuntimeControlReceipt = {
  action: 'approve' | 'deny' | 'steer' | 'stop';
  runId: string;
  actor: 'owner' | 'system';
  forwarded: true;
  decision?: ApprovalDecision;
};

export class RuntimeAuthorityError extends Error {
  constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'RuntimeAuthorityError';
  }
}
export class AgentRuntimeAuthorityBroker {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly bindings: AgentRuntimeBindingCoordinator,
    private readonly emergency?: EmergencyStopController,
  ) {}

  public async approve(
    runId: string,
    decision: ApprovalDecision,
    context: RuntimeControlContext,
    resolveAll = false,
  ): Promise<RuntimeControlReceipt> {
    const binding = this.requireBoundScope(runId, context);
    if (decision === 'deny') return this.deny(runId, context);
    this.requireOwner(context.actor, 'Only the owner may approve a Hermes tool request.');
    this.assertExecutionAllowed();
    if (decision !== 'once') {
      throw authorityError(
        'PERSISTENT_RUNTIME_APPROVAL_UNMAPPED',
        'Hermes session/always approval requires a mapped JARVIS privilege lease.',
      );
    }
    if (resolveAll) {
      throw authorityError('BULK_RUNTIME_APPROVAL_UNMAPPED', 'Bulk Hermes approval is not mapped to JARVIS authority.');
    }
    void binding;
    await this.runtime.approve(runId, 'once', false);
    return { action: 'approve', runId, actor: 'owner', forwarded: true, decision: 'once' };
  }
  public async deny(runId: string, context: RuntimeControlContext): Promise<RuntimeControlReceipt> {
    this.requireBoundScope(runId, context);
    const actor = this.requireTrustedControlActor(context.actor);
    await this.runtime.approve(runId, 'deny', false);
    return { action: 'deny', runId, actor, forwarded: true, decision: 'deny' };
  }

  public async steer(
    runId: string,
    instruction: string,
    context: RuntimeControlContext,
  ): Promise<RuntimeControlReceipt> {
    this.requireBoundScope(runId, context);
    const actor = this.requireTrustedControlActor(context.actor);
    this.assertExecutionAllowed();
    const value = String(instruction || '').trim();
    if (!value) throw authorityError('RUNTIME_STEER_EMPTY', 'Steer instruction is required.');
    await this.runtime.steer(runId, value);
    return { action: 'steer', runId, actor, forwarded: true };
  }

  public async stop(runId: string, context: RuntimeControlContext): Promise<RuntimeControlReceipt> {
    this.requireBoundScope(runId, context);
    const actor = this.requireTrustedControlActor(context.actor);
    await this.runtime.stop(runId);
    return { action: 'stop', runId, actor, forwarded: true };
  }
  public registerEmergencyStopParticipant(): () => void {
    if (!this.emergency) return () => undefined;
    return this.emergency.register({
      id: 'agent-runtime:hermes',
      cancelForEmergency: () => this.bindings.listBindings().map(({ runId }) => {
        void this.requestEmergencyStop(runId);
        return {
          ownerId: 'agent-runtime:hermes',
          workId: runId,
          state: 'CANCELLATION_REQUESTED' as const,
          detail: 'Hermes stop request dispatched after Emergency Stop.',
        };
      }),
    });
  }

  private async requestEmergencyStop(runId: string): Promise<void> {
    if (!this.emergency) return;
    try {
      await this.runtime.stop(runId);
      const run = await this.runtime.getRun(runId);
      const state = run.status === 'cancelled'
        ? 'CANCELLED' as const
        : run.status === 'completed'
          ? 'COMPLETED_BEFORE_CANCEL' as const
          : 'CANCELLATION_REQUESTED' as const;
      this.emergency.recordCancellationResult({
        ownerId: 'agent-runtime:hermes', workId: runId, state,
        detail: `Hermes stop endpoint accepted the request; observed status is ${run.status}.`,
      });
    } catch (error) {
      this.emergency.recordCancellationResult({
        ownerId: 'agent-runtime:hermes',
        workId: runId,
        state: 'FAILED_TO_CANCEL',
        detail: error instanceof Error ? error.message : 'Hermes stop request failed.',
      });
    }
  }

  private requireBoundScope(runId: string, context: RuntimeControlContext): AgentRuntimeBinding {
    const binding = this.bindings.bindingForRun(runId);
    if (!binding) throw authorityError('RUNTIME_RUN_NOT_BOUND', 'Hermes run is not bound to JARVIS authority.');
    const sessionId = String(context.jarvisSessionId || '').trim();
    if (!sessionId || sessionId !== binding.jarvisSessionId) {
      throw authorityError('RUNTIME_SCOPE_MISMATCH', 'Hermes run belongs to a different JARVIS session.');
    }
    if (binding.scopeKind === 'goal' && clean(context.goalId) !== binding.goalId) {
      throw authorityError('RUNTIME_SCOPE_MISMATCH', 'Hermes run belongs to a different JARVIS goal.');
    }
    if (binding.scopeKind === 'pending_goal' && clean(context.pendingGoalId) !== binding.pendingGoalId) {
      throw authorityError('RUNTIME_SCOPE_MISMATCH', 'Hermes run belongs to a different pending goal.');
    }
    if (binding.scopeKind === 'task' && clean(context.taskId) !== binding.taskId) {
      throw authorityError('RUNTIME_SCOPE_MISMATCH', 'Hermes run belongs to a different JARVIS task.');
    }
    return binding;
  }
  private requireOwner(actor: RuntimeControlActor, message: string): 'owner' {
    if (actor !== 'owner') throw authorityError('OWNER_RUNTIME_APPROVAL_REQUIRED', message);
    return 'owner';
  }

  private requireTrustedControlActor(actor: RuntimeControlActor): 'owner' | 'system' {
    if (actor === 'owner' || actor === 'system') return actor;
    throw authorityError('RUNTIME_SELF_CONTROL_FORBIDDEN', 'Model/JARVIS identity cannot control a Hermes run.');
  }

  private assertExecutionAllowed(): void {
    if (this.emergency?.snapshot().active) {
      throw authorityError('EMERGENCY_STOP_ACTIVE', 'Emergency Stop blocks Hermes approval and steering.');
    }
  }
}

function clean(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function authorityError(reasonCode: string, message: string): RuntimeAuthorityError {
  return new RuntimeAuthorityError(reasonCode, message);
}

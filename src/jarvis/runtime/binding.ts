import type { AgentRun, AgentRunInput, AgentRuntime } from './types';

export type AgentRuntimeBindingContext = {
  jarvisSessionId: string;
  goalId?: string;
  pendingGoalId?: string;
  taskId?: string;
  requestId?: string;
};

export type AgentRuntimeScopeKind = 'goal' | 'pending_goal' | 'task' | 'conversation';

export type AgentRuntimeBinding = AgentRuntimeBindingContext & {
  scopeKind: AgentRuntimeScopeKind;
  hermesSessionId: string;
  hermesSessionKey: string;
};

export type BoundAgentRun = {
  run: AgentRun;
  binding: AgentRuntimeBinding;
};

export async function createAgentRuntimeBinding(
  context: AgentRuntimeBindingContext,
): Promise<AgentRuntimeBinding> {
  const jarvisSessionId = required(context.jarvisSessionId, 'JARVIS session id');
  const scope = runtimeScope(context);
  const sessionDigest = await sha256(`jarvis/runtime-session/v1\0${jarvisSessionId}`);
  const scopeDigest = await sha256([
    'jarvis/runtime-scope/v1',
    jarvisSessionId,
    scope.kind,
    scope.identity,
  ].join('\0'));
  return {
    jarvisSessionId,
    goalId: clean(context.goalId),
    pendingGoalId: clean(context.pendingGoalId),
    taskId: clean(context.taskId),
    requestId: clean(context.requestId),
    scopeKind: scope.kind,
    hermesSessionId: `jv_scope_${scopeDigest.slice(0, 32)}`,
    hermesSessionKey: `jv_session_${sessionDigest.slice(0, 32)}`,
  };
}

export class AgentRuntimeBindingCoordinator {
  private readonly bindings = new Map<string, AgentRuntimeBinding>();

  constructor(private readonly runtime: AgentRuntime) {}

  public async startBoundRun(
    context: AgentRuntimeBindingContext,
    input: Omit<AgentRunInput, 'sessionId' | 'sessionKey'>,
  ): Promise<BoundAgentRun> {
    const binding = await createAgentRuntimeBinding(context);
    const run = await this.runtime.startRun({
      ...input,
      sessionId: binding.hermesSessionId,
      sessionKey: binding.hermesSessionKey,
    });
    if (!run.runId) throw new Error('Agent runtime returned a run without an id.');
    this.bindings.set(run.runId, binding);
    return { run, binding: cloneBinding(binding) };
  }

  public bindingForRun(runId: string): AgentRuntimeBinding | undefined {
    const binding = this.bindings.get(runId);
    return binding ? cloneBinding(binding) : undefined;
  }

  public forgetRun(runId: string): boolean {
    return this.bindings.delete(runId);
  }
}

function runtimeScope(context: AgentRuntimeBindingContext): {
  kind: AgentRuntimeScopeKind;
  identity: string;
} {
  const goalId = clean(context.goalId);
  if (goalId) return { kind: 'goal', identity: goalId };
  const pendingGoalId = clean(context.pendingGoalId);
  if (pendingGoalId) return { kind: 'pending_goal', identity: pendingGoalId };
  const taskId = clean(context.taskId);
  if (taskId) return { kind: 'task', identity: taskId };
  return { kind: 'conversation', identity: 'conversation' };
}

function clean(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function required(value: string | undefined, label: string): string {
  const normalized = clean(value);
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

async function sha256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable for runtime binding.');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function cloneBinding(binding: AgentRuntimeBinding): AgentRuntimeBinding {
  return { ...binding };
}

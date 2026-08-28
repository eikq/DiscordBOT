import type { VerificationState } from '../safety/types';
import type { EvolutionLifecycleResult } from '../evolution/lifecycle';
import type { ProceduralSkillVersion } from '../evolution/types';
import type { AgentRuntimeBindingContext, BoundAgentRun } from './binding';
import { AgentRuntimeBindingCoordinator } from './binding';
import type { AgentRuntimeJournalBridge } from './journalBridge';
import type { AgentRuntimeLearningBridge } from './learningBridge';
import type { AgentRuntimeMcpBoundary } from './mcpBoundary';
import type { AgentRuntimeMemoryBridge, RuntimeMemoryProjection } from './memoryBridge';
import { AgentRuntimeResilienceCoordinator } from './resilience';
import type { AgentEvent, AgentRun, AgentRunInput, AgentRuntime } from './types';

export type ReadOnlyRuntimeVerification = {
  state: VerificationState;
  summary: string;
  evidence: string[];
  failedChecks?: string[];
  outcome: 'success' | 'failure' | 'cancelled' | 'blocked' | 'degraded';
};

export type ReadOnlyOwnerTaskInput = {
  objective: string;
  binding: AgentRuntimeBindingContext;
  instructions?: string;
  allowedTools?: string[];
  journalOperationId?: string;
  verify: (input: { finalRun: AgentRun; events: AgentEvent[]; tools: string[] }) => Promise<ReadOnlyRuntimeVerification> | ReadOnlyRuntimeVerification;
};
export type ReadOnlyOwnerTaskResult = {
  bound: BoundAgentRun;
  finalRun: AgentRun;
  events: AgentEvent[];
  tools: string[];
  verification: ReadOnlyRuntimeVerification;
  memoryProjection?: RuntimeMemoryProjection;
  memoryCandidate?: ReturnType<AgentRuntimeMemoryBridge['candidateFromRun']>;
  learning?: {
    lifecycle: EvolutionLifecycleResult;
    skillCandidates: ProceduralSkillVersion[];
    autoPromotion: false;
  };
  readOnly: true;
  jarvisRetryCreated: false;
};

export type AgentRuntimeOwnerTaskCoordinatorOptions = {
  runtime: AgentRuntime;
  memory?: AgentRuntimeMemoryBridge;
  mcp?: AgentRuntimeMcpBoundary;
  journal?: AgentRuntimeJournalBridge;
  learning?: AgentRuntimeLearningBridge;
};

export class AgentRuntimeOwnerTaskCoordinator {
  private readonly bindings: AgentRuntimeBindingCoordinator;
  private readonly resilience: AgentRuntimeResilienceCoordinator;

  constructor(private readonly options: AgentRuntimeOwnerTaskCoordinatorOptions) {
    this.bindings = new AgentRuntimeBindingCoordinator(options.runtime);
    this.resilience = new AgentRuntimeResilienceCoordinator(options.runtime, this.bindings);
  }
  public async executeReadOnly(input: ReadOnlyOwnerTaskInput): Promise<ReadOnlyOwnerTaskResult> {
    const objective = String(input.objective || '').trim();
    if (!objective) throw new Error('Read-only runtime objective is required.');
    let preparedInput: Omit<AgentRunInput, 'sessionId' | 'sessionKey'> = {
      input: objective,
      instructions: [
        'JARVIS runtime scope: READ-ONLY.',
        'Do not create, modify, delete, move, rename, install, or change system state.',
        'Use inspection/read tools only. Tool availability never grants JARVIS authority.',
        input.instructions?.trim(),
      ].filter(Boolean).join('\n'),
    };
    let memoryProjection: RuntimeMemoryProjection | undefined;
    if (this.options.memory) {
      const prepared = await this.options.memory.prepareRunInput(
        preparedInput,
        { text: objective },
        'provider_managed',
      );
      preparedInput = prepared.input;
      memoryProjection = prepared.projection;
    }

    const bound = await this.resilience.startManagedRun(input.binding, preparedInput);
    const events: AgentEvent[] = [];
    const tools: string[] = [];
    const stream = this.options.mcp
      ? this.options.mcp.streamGuardedEvents(bound.run.runId)
      : this.options.runtime.streamEvents(bound.run.runId);
    for await (const event of stream) {
      events.push(event);
      if (event.tool && !tools.includes(event.tool)) tools.push(event.tool);
      if (event.tool && input.allowedTools?.length && !toolAllowed(event.tool, input.allowedTools)) {
        try { await this.options.runtime.stop(bound.run.runId); } catch { /* fail closed below */ }
        throw new RuntimeOwnerTaskError(
          'RUNTIME_READ_ONLY_TOOL_OUT_OF_SCOPE',
          `Hermes attempted tool ${event.tool} outside the read-only task scope.`,
        );
      }
      if (input.journalOperationId && this.options.journal) {
        this.options.journal.recordEvent(input.journalOperationId, event);
      }
    }

    const finalRun = await this.options.runtime.getRun(bound.run.runId);
    const verification = await input.verify({ finalRun, events, tools });
    if (verification.outcome === 'success' && verification.state !== 'VERIFIED') {
      throw new RuntimeOwnerTaskError(
        'RUNTIME_READ_ONLY_UNVERIFIED_SUCCESS',
        'A read-only Hermes run cannot become JARVIS success without independent verification.',
      );
    }
    const memoryCandidate = this.options.memory?.candidateFromRun(finalRun);
    let learning: ReadOnlyOwnerTaskResult['learning'];
    if (this.options.learning) {
      const learned = this.options.learning.recordVerifiedOutcome({
        run: finalRun,
        objective,
        outcome: verification.outcome,
        verification: {
          state: verification.state,
          summary: verification.summary,
          evidence: verification.evidence,
          failedChecks: verification.failedChecks,
        },
        observedTools: tools,
        workflow: tools.map(tool => `Inspect with ${tool}`),
        evidence: [`runtime-binding:${bound.binding.scopeKind}`],
      });
      learning = {
        lifecycle: learned.lifecycle,
        skillCandidates: learned.skillCandidates,
        autoPromotion: false,
      };
    }

    return {
      bound, finalRun, events, tools, verification,
      ...(memoryProjection ? { memoryProjection } : {}),
      ...(memoryCandidate ? { memoryCandidate } : {}),
      ...(learning ? { learning } : {}),
      readOnly: true,
      jarvisRetryCreated: false,
    };
  }
}
function toolAllowed(tool: string, allowed: string[]): boolean {
  const value = tool.trim().toLowerCase();
  return allowed.some(item => {
    const rule = item.trim().toLowerCase();
    return rule.endsWith('*') ? value.startsWith(rule.slice(0, -1)) : value === rule;
  });
}

export class RuntimeOwnerTaskError extends Error {
  constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'RuntimeOwnerTaskError';
  }
}

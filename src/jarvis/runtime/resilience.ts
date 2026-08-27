import { redactSecrets } from '../security/redaction';
import type {
  AgentRuntimeBindingContext,
  BoundAgentRun,
} from './binding';
import { AgentRuntimeBindingCoordinator } from './binding';
import type {
  AgentRun,
  AgentRunInput,
  AgentRuntime,
  WaitForRunOptions,
} from './types';

export type ManagedRuntimeResult = {
  bound: BoundAgentRun;
  finalRun: AgentRun;
  configuredModel?: string;
  finalModel?: string;
  fallbackObserved: boolean | null;
  providerManagedFallback: true;
  jarvisRetryCreated: false;
  retryDisposition: 'NONE' | 'SURFACE_FINAL_FAILURE' | 'CANCELLED';
  error?: string;
};

export class RuntimeResilienceError extends Error {
  constructor(public readonly reasonCode: string, message: string) {
    super(message);
    this.name = 'RuntimeResilienceError';
  }
}
export class AgentRuntimeResilienceCoordinator {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly bindings: AgentRuntimeBindingCoordinator,
  ) {}

  public async startManagedRun(
    context: AgentRuntimeBindingContext,
    input: Omit<AgentRunInput, 'sessionId' | 'sessionKey'>,
  ): Promise<BoundAgentRun> {
    if (input.model) {
      throw new RuntimeResilienceError(
        'RUNTIME_MODEL_PIN_FORBIDDEN',
        'Provider-managed JARVIS runs must leave model selection to Hermes fallback routing.',
      );
    }
    return this.bindings.startBoundRun(context, {
      ...input,
      model: undefined,
    });
  }

  public async executeManagedRun(
    context: AgentRuntimeBindingContext,
    input: Omit<AgentRunInput, 'sessionId' | 'sessionKey'>,
    options: WaitForRunOptions = {},
  ): Promise<ManagedRuntimeResult> {
    const configuredModel = await this.configuredModel();
    const bound = await this.startManagedRun(context, input);
    const finalRun = await this.runtime.waitForRun(bound.run.runId, options);
    const finalModel = finalRun.model || bound.run.model;
    const retryDisposition = finalRun.status === 'failed'
      ? 'SURFACE_FINAL_FAILURE' as const
      : finalRun.status === 'cancelled'
        ? 'CANCELLED' as const
        : 'NONE' as const;
    return {
      bound,
      finalRun,
      configuredModel,
      finalModel,
      fallbackObserved: fallbackEvidence(configuredModel, finalModel),
      providerManagedFallback: true,
      jarvisRetryCreated: false,
      retryDisposition,
      ...(finalRun.error ? { error: redactSecrets(finalRun.error).slice(0, 500) } : {}),
    };
  }

  private async configuredModel(): Promise<string | undefined> {
    try {
      return (await this.runtime.getCapabilities()).model;
    } catch {
      return undefined;
    }
  }
}

function fallbackEvidence(configuredModel?: string, finalModel?: string): boolean | null {
  if (!isConcreteModel(configuredModel) || !isConcreteModel(finalModel)) return null;
  return configuredModel !== finalModel;
}

function isConcreteModel(value?: string): value is string {
  return Boolean(value && value !== 'hermes-agent');
}

import type { NightConfig, ProviderFailureCode } from '../night/types';
import { CursorGrokCodingAgent } from './CursorGrokCodingAgent';
import { LocalQwenCodingAgent } from './LocalQwenCodingAgent';
import { findAgentExecutable } from './cursorPreflight';
import type { CodingAttemptInput, CodingAttemptResult, CodingWorker } from './types';

export class CodingWorkerRouter implements CodingWorker {
  readonly id = 'worker-router';
  readonly kind = 'local-qwen' as const;
  readonly workers: CodingWorker[];
  lastWorkerId = '';

  constructor(
    private readonly config: NightConfig,
    workers?: CodingWorker[],
  ) {
    this.workers = workers || defaultWorkers(config);
  }

  resetContext(): void {
    for (const worker of this.workers) worker.resetContext();
  }

  async attempt(input: CodingAttemptInput): Promise<CodingAttemptResult> {
    const enabled = this.workers.filter((worker) => providerEnabled(this.config, worker.id, worker.kind));
    const errors: string[] = [];
    for (const worker of enabled) {
      worker.resetContext();
      const result = await worker.attempt(input);
      this.lastWorkerId = worker.id;
      if (!result.providerFailure) return result;
      errors.push(worker.id + ': ' + result.providerFailure.code + ' ' + result.providerFailure.message);
      if (!this.config.fallbackOn.includes(result.providerFailure.code as ProviderFailureCode)) {
        return result;
      }
    }
    return {
      workerId: this.lastWorkerId || 'none',
      providerKind: 'local-qwen',
      summary: errors.join(' | ') || 'No coding worker available',
      toolCalls: 0,
      contextReset: true,
      providerFailure: {
        code: 'provider_error',
        message: errors.join(' | ') || 'No coding worker available',
      },
    };
  }
}

function providerEnabled(config: NightConfig, id: string, kind: CodingWorker['kind']): boolean {
  if (kind === 'local-qwen' && !config.localQwenFallback) return false;
  const listed = config.workerProviders.find((item) => item.id === id || item.kind === kind);
  return listed ? listed.enabled : kind === 'local-qwen';
}

export function defaultWorkers(config: NightConfig): CodingWorker[] {
  const ordered = [...config.workerProviders].sort((a, b) => b.priority - a.priority);
  const workers: CodingWorker[] = [];
  for (const item of ordered) {
    if (!item.enabled) continue;
    if (item.kind === 'cursor-cli') {
      workers.push(new CursorGrokCodingAgent(
        config,
        item.model || config.cursorModel,
        {
          executable: findAgentExecutable(),
          useForce: config.workspaceMode === 'isolated-worktree',
        },
        item.id,
      ));
    }
    if (item.kind === 'local-qwen' && config.localQwenFallback) {
      workers.push(new LocalQwenCodingAgent(config, item.id));
    }
  }
  if (config.localQwenFallback && !workers.some((item) => item.kind === 'local-qwen')) {
    workers.push(new LocalQwenCodingAgent(config));
  }
  return workers;
}
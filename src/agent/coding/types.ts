import type { NightTask, ProviderFailureCode, WorkerProviderKind } from '../night/types';
import type { NightToolHost } from '../night/NightToolHost';

export type CodingAttemptInput = {
  task: NightTask;
  attempt: number;
  previousErrors: string[];
  contextPacket: string;
  tools: NightToolHost;
};

export type CodingAttemptResult = {
  workerId: string;
  providerKind: WorkerProviderKind;
  summary: string;
  toolCalls: number;
  contextReset: true;
  providerFailure?: { code: ProviderFailureCode; message: string };
};

export interface CodingWorker {
  readonly id: string;
  readonly kind: WorkerProviderKind;
  resetContext(): void;
  attempt(input: CodingAttemptInput): Promise<CodingAttemptResult>;
}
import type { CodingAttemptInput, CodingAttemptResult, CodingWorker } from './types';

export type ScriptedStep = (input: CodingAttemptInput) => Promise<void> | void;

export class ScriptedCodingAgent implements CodingWorker {
  readonly kind = 'scripted' as const;
  private resets = 0;

  constructor(
    public readonly id: string,
    private readonly steps: ScriptedStep | ScriptedStep[],
  ) {}

  resetCount(): number {
    return this.resets;
  }

  resetContext(): void {
    this.resets += 1;
  }

  async attempt(input: CodingAttemptInput): Promise<CodingAttemptResult> {
    const list = Array.isArray(this.steps) ? this.steps : [this.steps];
    for (const step of list) {
      await step(input);
    }
    return {
      workerId: this.id,
      providerKind: 'scripted',
      summary: 'scripted attempt ' + input.attempt,
      toolCalls: list.length,
      contextReset: true,
    };
  }
}
import type { AudioInput, AudioInputState, PcmFrame } from './types';

/**
 * Deterministic AudioInput for tests. Does not open a microphone.
 */
export class ScriptedAudioInput implements AudioInput {
  public readonly id = 'scripted';
  private state: AudioInputState = 'idle';
  private handlers = new Set<(frame: PcmFrame) => void>();
  private readonly startError?: Error & { code?: AudioInputState };

  constructor(options: { startError?: Error & { code?: AudioInputState } } = {}) {
    this.startError = options.startError;
  }

  public getState(): AudioInputState {
    return this.state;
  }

  public async start(): Promise<void> {
    if (this.startError) {
      this.state = this.startError.code === 'permission-denied' ? 'permission-denied' : 'unavailable';
      throw this.startError;
    }
    this.state = 'capturing';
  }

  public async stop(): Promise<void> {
    this.state = 'idle';
  }

  public onFrame(handler: (frame: PcmFrame) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public emit(frame: PcmFrame): void {
    if (this.state !== 'capturing') return;
    for (const handler of this.handlers) handler(frame);
  }
}

export function microphoneStartError(
  kind: 'unavailable' | 'permission-denied',
  message: string,
): Error & { code: 'unavailable' | 'permission-denied' } {
  return Object.assign(new Error(message), { code: kind });
}

import type { SttLifecycleStatus, SttPort, TtsLifecycleStatus, TtsPort } from './types';

export class MockSttPort implements SttPort {
  public readonly events: string[] = [];
  private current: SttLifecycleStatus = 'idle';
  private readonly ready: boolean;

  constructor(options: { available?: boolean } = {}) {
    this.ready = options.available !== false;
  }

  public available(): boolean {
    return this.ready;
  }

  public listen(): void {
    this.current = this.ready ? 'listening' : 'unavailable';
    this.events.push(`listen:${this.current}`);
  }

  public async transcribe(turnId: string, text: string): Promise<{ text: string; status: 'ok' | 'unavailable' | 'error' }> {
    if (!this.ready) {
      this.current = 'unavailable';
      this.events.push(`unavailable:${turnId}`);
      return { text: '', status: 'unavailable' };
    }
    this.current = 'transcribing';
    this.events.push(`transcribing:${turnId}`);
    this.current = 'done';
    this.events.push(`done:${turnId}`);
    return { text, status: 'ok' };
  }

  public status(): SttLifecycleStatus {
    return this.current;
  }
}

export class MockTtsPort implements TtsPort {
  public readonly events: string[] = [];
  public cancelled: string[] = [];
  private current: TtsLifecycleStatus = 'idle';
  private elapsed = 0;
  private readonly ready: boolean;
  private readonly defer: boolean;
  private speakingTurn: string | null = null;
  private cancelledTurns = new Set<string>();
  private leftoverText = '';
  private waiter?: (value: { status: 'spoken' | 'cancelled' | 'unavailable' }) => void;
  private skipDeferOnce = false;

  constructor(options: { available?: boolean; defer?: boolean } = {}) {
    this.ready = options.available !== false;
    this.defer = options.defer === true;
  }

  public available(): boolean {
    return this.ready;
  }

  public async speak(turnId: string, text: string): Promise<{ status: 'spoken' | 'cancelled' | 'unavailable' }> {
    if (!this.ready) {
      this.current = 'unavailable';
      this.events.push(`unavailable:${turnId}`);
      return { status: 'unavailable' };
    }
    this.speakingTurn = turnId;
    this.leftoverText = text;
    this.current = 'synthesizing';
    this.events.push(`synthesizing:${turnId}`);
    this.current = 'speaking';
    this.elapsed = Math.max(400, text.length * 20);
    this.events.push(`speaking:${turnId}`);
    if (this.defer && !this.skipDeferOnce) {
      return await new Promise(resolve => {
        this.waiter = resolve;
      });
    }
    this.skipDeferOnce = false;
    if (this.cancelledTurns.has(turnId)) {
      this.current = 'cancelled';
      this.events.push(`cancelled:${turnId}`);
      this.speakingTurn = null;
      return { status: 'cancelled' };
    }
    this.current = 'done';
    this.events.push(`done:${turnId}`);
    this.speakingTurn = null;
    this.leftoverText = '';
    return { status: 'spoken' };
  }

  public async cancel(turnId: string): Promise<void> {
    this.cancelledTurns.add(turnId);
    this.cancelled.push(turnId);
    this.current = 'cancelled';
    this.events.push(`cancel:${turnId}`);
    if (this.speakingTurn === turnId) this.speakingTurn = null;
    this.waiter?.({ status: 'cancelled' });
    this.waiter = undefined;
  }

  public async resume(turnId: string): Promise<{ status: 'spoken' | 'cancelled' | 'unavailable' }> {
    if (!this.ready) return { status: 'unavailable' };
    this.cancelledTurns.delete(turnId);
    this.events.push(`resume:${turnId}`);
    this.skipDeferOnce = true;
    return this.speak(turnId, this.leftoverText || 'continued');
  }

  public status(): TtsLifecycleStatus {
    return this.current;
  }

  public elapsedMs(): number {
    return this.elapsed;
  }
}

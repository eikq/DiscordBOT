import { redactDeep, redactSecrets } from './redaction';
import type { JarvisOperationEvent, JarvisOperationEventType } from './types';

export type JarvisEventListener = (event: JarvisOperationEvent) => void;

export type EventEmitMeta = {
  taskId?: string;
  turnId?: string;
  visualState?: string;
  progress?: { current: number; total: number; unit?: string };
  simulated?: boolean;
  errorCode?: string;
};

const DEFAULT_MAX_RECENT = 200;

export class JarvisEventBus {
  private readonly listeners = new Set<JarvisEventListener>();
  private readonly recentEvents: JarvisOperationEvent[] = [];
  private seq = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly maxRecent = DEFAULT_MAX_RECENT,
  ) {}

  public emit(
    type: JarvisOperationEventType,
    summary: string,
    payload: Record<string, unknown> = {},
    level: JarvisOperationEvent['level'] = 'info',
    meta: EventEmitMeta = {},
  ): JarvisOperationEvent {
    this.seq += 1;
    const event: JarvisOperationEvent = {
      id: `evt_${this.seq.toString(16).padStart(6, '0')}`,
      seq: this.seq,
      type,
      at: new Date(this.now()).toISOString(),
      level,
      summary: redactSecrets(summary).slice(0, 180),
      payload: redactDeep(payload) as Record<string, unknown>,
      ...(meta.taskId ? { taskId: meta.taskId } : {}),
      ...(meta.turnId ? { turnId: meta.turnId } : {}),
      ...(meta.visualState ? { visualState: meta.visualState } : {}),
      ...(meta.progress ? { progress: meta.progress } : {}),
      ...(meta.simulated ? { simulated: true } : {}),
      ...(meta.errorCode ? { errorCode: meta.errorCode } : {}),
    };
    this.recentEvents.push(event);
    while (this.recentEvents.length > this.maxRecent) this.recentEvents.shift();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A telemetry subscriber must not break operations.
      }
    }
    return event;
  }

  public subscribe(listener: JarvisEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public recent(limit = 20): JarvisOperationEvent[] {
    const cap = Math.max(1, Math.min(limit, this.maxRecent));
    return this.recentEvents.slice(-cap);
  }

  public recentAfter(seq: number, limit = this.maxRecent): JarvisOperationEvent[] {
    return this.recentEvents.filter(event => event.seq > seq).slice(0, Math.max(1, Math.min(limit, this.maxRecent)));
  }

  public lastSeq(): number {
    return this.seq;
  }

  public size(): number {
    return this.recentEvents.length;
  }

  public maxSize(): number {
    return this.maxRecent;
  }
}

let sharedBus: JarvisEventBus | undefined;

export function sharedJarvisEventBus(): JarvisEventBus {
  sharedBus ??= new JarvisEventBus();
  return sharedBus;
}

export function resetSharedJarvisEventBus(): void {
  sharedBus = undefined;
}

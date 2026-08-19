import { redactDeep, redactSecrets } from './redaction';
import type { JarvisOperationEvent, JarvisOperationEventType } from './types';

export type JarvisEventListener = (event: JarvisOperationEvent) => void;

const MAX_RECENT = 80;

export class JarvisEventBus {
  private readonly listeners = new Set<JarvisEventListener>();
  private readonly recentEvents: JarvisOperationEvent[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  public emit(
    type: JarvisOperationEventType,
    summary: string,
    payload: Record<string, unknown> = {},
    level: JarvisOperationEvent['level'] = 'info',
  ): JarvisOperationEvent {
    const event: JarvisOperationEvent = {
      type,
      at: new Date(this.now()).toISOString(),
      level,
      summary: redactSecrets(summary).slice(0, 180),
      payload: redactDeep(payload) as Record<string, unknown>,
    };
    this.recentEvents.push(event);
    if (this.recentEvents.length > MAX_RECENT) this.recentEvents.shift();
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
    return this.recentEvents.slice(-Math.max(1, Math.min(limit, MAX_RECENT)));
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

/**
 * Transient event channel between React state (turn results) and the
 * imperative WebGL scene. Events describe observable facts only —
 * "these memory nodes were retrieved", "this tool ran" — never invented
 * telemetry. The scene consumes them without per-frame React updates.
 */

export type CorePulse =
  | { kind: 'memory'; nodeIds: string[] }
  | { kind: 'tool'; toolIds: string[]; failed?: boolean }
  | { kind: 'response' };

export type PulseListener = (pulse: CorePulse) => void;

export class PulseBus {
  private listeners = new Set<PulseListener>();

  public subscribe(listener: PulseListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public emit(pulse: CorePulse): void {
    for (const listener of [...this.listeners]) {
      listener(pulse);
    }
  }

  public listenerCount(): number {
    return this.listeners.size;
  }
}

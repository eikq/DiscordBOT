import type { JarvisClock } from './types';

export const systemClock: JarvisClock = {
  now: () => Date.now(),
};

export class FakeClock implements JarvisClock {
  public current: number;

  constructor(current = Date.UTC(2026, 7, 19, 10, 0, 0)) {
    this.current = current;
  }

  public now(): number {
    return this.current;
  }

  public advance(ms: number): number {
    this.current += ms;
    return this.current;
  }

  public set(ms: number): number {
    this.current = ms;
    return this.current;
  }
}

export function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

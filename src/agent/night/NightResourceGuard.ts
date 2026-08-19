import fs from 'node:fs';
import type { NightConfig } from './types';

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

export function isGuardStop(result: GuardVerdict): result is { ok: false; reason: string } {
  return result.ok === false;
}

export class NightResourceGuard {
  private oomCount = 0;
  private resourceFailures = 0;

  constructor(
    private readonly config: NightConfig,
    private readonly now: () => number = () => Date.now(),
    private readonly startedAt: number = Date.now(),
  ) {}

  noteOom(): void {
    this.oomCount += 1;
    this.resourceFailures += 1;
  }

  noteResourceFailure(): void {
    this.resourceFailures += 1;
  }

  check(workspaceRoot: string): GuardVerdict {
    const elapsedHours = (this.now() - this.startedAt) / 3_600_000;
    if (elapsedHours >= this.config.maxRuntimeHours) {
      return { ok: false, reason: 'Configured maxRuntimeHours reached (' + this.config.maxRuntimeHours + ').' };
    }
    if (this.config.stopAt) {
      const stop = Date.parse(this.config.stopAt);
      if (Number.isFinite(stop) && this.now() >= stop) {
        return { ok: false, reason: 'Configured stopAt reached (' + this.config.stopAt + ').' };
      }
    }
    if (this.oomCount >= 2) {
      return { ok: false, reason: 'Repeated OOM/resource failures; stopping the night run.' };
    }
    if (this.resourceFailures >= 3) {
      return { ok: false, reason: 'Repeated resource failures; stopping the night run.' };
    }
    const free = diskFreeBytes(workspaceRoot);
    if (typeof free === 'number' && free < this.config.minDiskFreeBytes) {
      return { ok: false, reason: 'Disk free space is critically low (' + free + ' bytes).' };
    }
    return { ok: true };
  }
}

export function diskFreeBytes(target: string): number | undefined {
  const statfs = (fs as typeof fs & { statfsSync?: (p: string) => { bavail: number; bsize: number } }).statfsSync;
  if (typeof statfs !== 'function') return undefined;
  try {
    const info = statfs(target);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return undefined;
  }
}

export function looksLikeOom(text: string): boolean {
  return /out of memory|cuda.*oom|not enough memory|kv cache.*fail/i.test(text);
}
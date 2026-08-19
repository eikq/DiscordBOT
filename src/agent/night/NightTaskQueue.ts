import type { NightConfig, NightTask } from './types';
import { NightPolicy } from './NightPolicy';

export class NightTaskQueue {
  constructor(
    private readonly tasks: NightTask[],
    private readonly config: NightConfig,
    private readonly policy: NightPolicy,
  ) {}

  all(): NightTask[] {
    return [...this.tasks];
  }

  get(id: string): NightTask | undefined {
    return this.tasks.find((task) => task.id === id);
  }

  update(id: string, status: NightTask['status']): void {
    const task = this.get(id);
    if (task) task.status = status;
  }

  eligible(): NightTask[] {
    const byId = new Map(this.tasks.map((task) => [task.id, task]));
    return this.tasks
      .filter((task) => {
        if (task.status !== 'READY') return false;
        if (!this.policy.isNightSafe(task).ok) return false;
        return task.dependencies.every((dep) => byId.get(dep)?.status === 'PASS');
      })
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  next(): NightTask | undefined {
    return this.eligible()[0];
  }

  blockRemainingReady(status: NightTask['status'] = 'BLOCKED_PROVIDER'): NightTask[] {
    const blocked: NightTask[] = [];
    for (const task of this.tasks) {
      if (task.status === 'READY') {
        task.status = status;
        blocked.push(task);
      }
    }
    return blocked;
  }

  skipUnsafeReady(): NightTask[] {
    const skipped: NightTask[] = [];
    for (const task of this.tasks) {
      if (task.status !== 'READY') continue;
      const safe = this.policy.isNightSafe(task);
      if (!safe.ok) {
        task.status = task.requiresHuman ? 'NEEDS_HUMAN_VERIFY' : 'SKIPPED';
        skipped.push(task);
      }
    }
    return skipped;
  }

  remainingSlots(completedCount: number): number {
    return Math.max(0, this.config.maxTasks - completedCount);
  }
}
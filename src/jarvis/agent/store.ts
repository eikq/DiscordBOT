import { randomBytes } from 'node:crypto';
import type { PlanStep, WorkTask, WorkTaskStatus } from './types';
import { assertTransition, isTerminalStatus } from './transitions';
import { recoverInterruptedTask } from './recoveryState';
import { SqliteWorkTaskPersistence } from './sqliteStore';
import { sanitizeTaskForPersist } from './persistSanitize';

export function newTaskId(): string {
  return `task_${randomBytes(6).toString('hex')}`;
}

export function newStepId(prefix = 'step'): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export type WorkTaskStoreOptions = {
  now?: () => number;
  dbPath?: string;
};

export class WorkTaskStore {
  private readonly tasks = new Map<string, WorkTask>();
  private readonly now: () => number;
  private readonly disk?: SqliteWorkTaskPersistence;

  constructor(nowOrOptions?: (() => number) | WorkTaskStoreOptions, maybeOptions: WorkTaskStoreOptions = {}) {
    if (typeof nowOrOptions === 'function') {
      this.now = nowOrOptions;
      this.disk = maybeOptions.dbPath ? new SqliteWorkTaskPersistence(maybeOptions.dbPath) : undefined;
    } else {
      this.now = nowOrOptions?.now ?? (() => Date.now());
      this.disk = nowOrOptions?.dbPath ? new SqliteWorkTaskPersistence(nowOrOptions.dbPath) : undefined;
    }
    if (this.disk) {
      for (const task of this.disk.load()) this.tasks.set(task.id, task);
    }
  }

  public create(input: {
    objective: string;
    plan: PlanStep[];
    retryBudget?: number;
    simulated?: boolean;
    permissionRequirements?: string[];
    requestId?: string;
    sessionId?: string;
    turnId?: string;
  }): WorkTask {
    const at = new Date(this.now()).toISOString();
    const task: WorkTask = {
      id: newTaskId(),
      objective: input.objective.trim(),
      createdAt: at,
      updatedAt: at,
      status: 'RECEIVED',
      plan: input.plan.map(step => ({ ...step, dependencies: [...step.dependencies] })),
      evidence: [],
      toolResults: [],
      permissionRequirements: input.permissionRequirements ?? [],
      retryBudget: input.retryBudget ?? 2,
      retriesUsed: 0,
      errors: [],
      simulated: input.simulated || undefined,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.turnId ? { turnId: input.turnId } : {}),
    };
    this.tasks.set(task.id, task);
    this.write(task);
    return this.clone(task);
  }

  public get(id: string): WorkTask | undefined {
    const task = this.tasks.get(id);
    return task ? this.clone(task) : undefined;
  }

  public list(): WorkTask[] {
    return [...this.tasks.values()].map(task => this.clone(task));
  }

  public active(): WorkTask[] {
    return this.list().filter(task => !['COMPLETED', 'FAILED', 'CANCELLED', 'BLOCKED'].includes(task.status));
  }

  public save(task: WorkTask): WorkTask {
    const current = this.tasks.get(task.id);
    if (current && isTerminalStatus(current.status) && task.status !== current.status) {
      return this.clone(current);
    }
    if (current && current.status !== task.status) {
      assertTransition(current.status, task.status);
    }
    const next = {
      ...task,
      plan: task.plan.map(step => ({ ...step })),
      evidence: [...task.evidence],
      toolResults: [...task.toolResults],
      errors: [...task.errors],
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.tasks.set(task.id, next);
    this.write(next);
    return this.clone(next);
  }

  public setStatus(id: string, status: WorkTaskStatus): WorkTask {
    const task = this.require(id);
    if (isTerminalStatus(task.status) && status !== task.status) {
      return this.clone(task);
    }
    assertTransition(task.status, status);
    task.status = status;
    task.updatedAt = new Date(this.now()).toISOString();
    this.write(task);
    return this.clone(task);
  }

  public snapshot(): WorkTask[] {
    return this.list();
  }

  public restore(tasks: WorkTask[]): void {
    this.tasks.clear();
    for (const task of tasks) {
      const recovered = recoverInterruptedTask(this.clone(task));
      this.tasks.set(recovered.id, recovered);
      this.write(recovered);
    }
  }

  public close(): void {
    this.disk?.close();
  }

  private write(task: WorkTask): void {
    this.disk?.upsert(sanitizeTaskForPersist(task));
  }

  private require(id: string): WorkTask {
    const task = this.tasks.get(id);
    if (!task) throw Object.assign(new Error('Unknown work task.'), { reasonCode: 'PLAN_INVALID' });
    return task;
  }

  private clone(task: WorkTask): WorkTask {
    return structuredClone(task);
  }
}

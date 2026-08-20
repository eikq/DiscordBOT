import { randomBytes } from 'node:crypto';
import type { PlanStep, WorkTask, WorkTaskStatus } from './types';
import { assertTransition, isTerminalStatus } from './transitions';

export function newTaskId(): string {
  return `task_${randomBytes(6).toString('hex')}`;
}

export function newStepId(prefix = 'step'): string {
  return `${prefix}_${randomBytes(4).toString('hex')}`;
}

export class WorkTaskStore {
  private readonly tasks = new Map<string, WorkTask>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  public create(input: {
    objective: string;
    plan: PlanStep[];
    retryBudget?: number;
    simulated?: boolean;
    permissionRequirements?: string[];
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
    };
    this.tasks.set(task.id, task);
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
    return this.clone(next);
  }

  public setStatus(id: string, status: WorkTaskStatus): WorkTask {
    const task = this.require(id);
    assertTransition(task.status, status);
    task.status = status;
    task.updatedAt = new Date(this.now()).toISOString();
    return this.clone(task);
  }

  public snapshot(): WorkTask[] {
    return this.list();
  }

  public restore(tasks: WorkTask[]): void {
    this.tasks.clear();
    for (const task of tasks) this.tasks.set(task.id, this.clone(task));
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

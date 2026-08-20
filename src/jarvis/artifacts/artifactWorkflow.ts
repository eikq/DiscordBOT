import { randomBytes } from 'node:crypto';
import type { JsonCollection } from '../evolution/persistTypes';
import type { ArtifactClass, ArtifactRef, ArtifactTask, ArtifactStage } from './types';

export type ArtifactProvider = {
  id: string;
  simulate: boolean;
  runStage: (task: ArtifactTask, stageId: string) => ArtifactStage;
  validate: (artifact: ArtifactRef) => { passed: boolean; detail: string };
};

export class ArtifactWorkflow {
  private readonly tasks = new Map<string, ArtifactTask>();
  private readonly now: () => number;

  constructor(
    now: () => number = () => Date.now(),
    private readonly persist?: JsonCollection<ArtifactTask>,
  ) {
    this.now = now;
    for (const item of persist?.load() ?? []) this.tasks.set(item.taskId, item);
  }

  public create(input: {
    artifactClass: ArtifactClass;
    stages: Array<{ stageId: string; title: string }>;
    provider: string;
    simulated?: boolean;
    inputFiles?: ArtifactRef[];
  }): ArtifactTask {
    const simulated = input.simulated !== false;
    const task: ArtifactTask = {
      taskId: `art_${randomBytes(6).toString('hex')}`,
      artifactClass: input.artifactClass,
      status: 'pending',
      stages: input.stages.map(stage => ({
        stageId: stage.stageId,
        title: stage.title,
        status: 'pending',
        warnings: [],
        errors: [],
      })),
      input: { files: input.inputFiles ?? [] },
      output: { files: [] },
      validation: { passed: false, detail: 'not_run' },
      provider: input.provider,
      simulated,
      publish: 'blocked_until_owner',
    };
    void this.now;
    this.tasks.set(task.taskId, task);
    this.flush();
    return clone(task);
  }

  public run(taskId: string, provider: ArtifactProvider): ArtifactTask {
    const task = this.require(taskId);
    task.status = 'running';
    for (const stage of task.stages) {
      const result = provider.runStage(task, stage.stageId);
      Object.assign(stage, result);
      if (stage.status === 'failed' || stage.status === 'blocked') {
        task.status = stage.status === 'blocked' ? 'blocked' : 'failed';
        task.resume = { stageId: stage.stageId };
        this.flush();
        return clone(task);
      }
    }
    const artifact = task.output.files[0];
    if (!artifact) {
      task.status = 'failed';
      task.validation = { passed: false, detail: 'No output artifact.' };
      this.flush();
      return clone(task);
    }
    task.validation = provider.validate(artifact);
    task.status = task.validation.passed ? 'ready' : 'failed';
    this.flush();
    return clone(task);
  }

  public list(): ArtifactTask[] {
    return [...this.tasks.values()].map(clone);
  }

  public get(taskId: string): ArtifactTask | undefined {
    const item = this.tasks.get(taskId);
    return item ? clone(item) : undefined;
  }

  private require(taskId: string): ArtifactTask {
    const item = this.tasks.get(taskId);
    if (!item) throw new Error('Unknown artifact task.');
    return item;
  }

  private flush(): void {
    this.persist?.replace(this.list());
  }
}

function clone(task: ArtifactTask): ArtifactTask {
  return structuredClone(task);
}

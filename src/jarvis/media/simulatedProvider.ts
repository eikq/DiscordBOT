import type { ArtifactProvider } from '../artifacts/artifactWorkflow';
import type { ArtifactRef, ArtifactStage, ArtifactTask } from '../artifacts/types';
import { MEDIA_STAGES } from './types';

/**
 * Cloud/fixture media provider. Does not install MoneyPrinterTurbo.
 */
export class SimulatedMediaProvider implements ArtifactProvider {
  public readonly id = 'simulated-media';
  public readonly simulate = true;

  public runStage(task: ArtifactTask, stageId: string): ArtifactStage {
    const stage = task.stages.find(item => item.stageId === stageId);
    if (!stage) {
      return {
        stageId,
        title: stageId,
        status: 'failed',
        provider: this.id,
        warnings: [],
        errors: [`Unknown stage ${stageId}`],
      };
    }
    if (stageId === 'DELIVER') {
      task.output.files = [{
        path: `simulated://${task.taskId}.mp4`,
        class: task.artifactClass,
        mime: task.artifactClass === 'video' ? 'video/mp4' : 'application/octet-stream',
        bytes: 128,
        simulated: true,
      }];
    }
    return {
      ...stage,
      status: 'ok',
      provider: this.id,
      progress: {
        current: MEDIA_STAGES.indexOf(stageId as typeof MEDIA_STAGES[number]) + 1,
        total: MEDIA_STAGES.length,
        unit: 'stage',
      },
    };
  }

  public validate(artifact: ArtifactRef): { passed: boolean; detail: string } {
    if (!artifact.simulated) {
      return { passed: false, detail: 'Live media artifacts are BLOCKED_LOCAL_ACCEPTANCE.' };
    }
    if (!artifact.path || (artifact.bytes ?? 0) <= 0) {
      return { passed: false, detail: 'Simulated artifact missing path or size.' };
    }
    return { passed: true, detail: 'Simulated artifact matches provider contract.' };
  }
}

export function mediaStageList(): Array<{ stageId: string; title: string }> {
  return MEDIA_STAGES.map(stageId => ({ stageId, title: stageId.toLowerCase() }));
}

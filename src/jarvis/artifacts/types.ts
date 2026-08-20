export const ARTIFACT_CLASSES = ['video', 'audio', 'report', 'dataset', 'code', 'export'] as const;
export type ArtifactClass = (typeof ARTIFACT_CLASSES)[number];

export const ARTIFACT_STAGE_STATUSES = [
  'pending',
  'running',
  'ok',
  'failed',
  'skipped',
  'blocked',
] as const;
export type ArtifactStageStatus = (typeof ARTIFACT_STAGE_STATUSES)[number];

export type ArtifactRef = {
  path: string;
  class: ArtifactClass;
  mime?: string;
  bytes?: number;
  simulated: boolean;
};

export type ArtifactManifest = {
  files: ArtifactRef[];
};

export type ArtifactStage = {
  stageId: string;
  title: string;
  status: ArtifactStageStatus;
  provider?: string;
  warnings: string[];
  errors: string[];
  progress?: { current: number; total: number; unit?: string };
};

export type ArtifactTask = {
  taskId: string;
  artifactClass: ArtifactClass;
  status: 'pending' | 'running' | 'ready' | 'failed' | 'blocked';
  stages: ArtifactStage[];
  input: ArtifactManifest;
  output: ArtifactManifest;
  validation: { passed: boolean; detail: string };
  resume?: { stageId: string; cursor?: string };
  provider: string;
  simulated: boolean;
  publish: 'not_requested' | 'blocked_until_owner';
};

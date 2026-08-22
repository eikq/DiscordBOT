export type ProjectCommandKind =
  | 'npm-install'
  | 'npm-ci'
  | 'npm-run'
  | 'node-test';

export type ProjectCommandRequest = {
  kind: ProjectCommandKind;
  workspace: string;
  script?: string;
  extraArgs?: string[];
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type ProjectCommandEvidence = {
  commandType: ProjectCommandKind;
  argv: string[];
  workspace: string;
  exitCode: number | null;
  durationMs: number;
  stdoutSummary: string;
  stderrSummary: string;
  passed: boolean;
  skipped?: boolean;
  skipReason?: string;
};

export type ProjectCommandRunner = {
  run(request: ProjectCommandRequest): Promise<ProjectCommandEvidence>;
};

export type PreviewArtifact = {
  url: string;
  workspace: string;
  processRef: string;
  status: 'starting' | 'running' | 'stopped' | 'unknown' | 'failed';
  host: '127.0.0.1';
  port: number;
  script: string;
  pid?: number;
};

export type DevServerHandle = PreviewArtifact & {
  startedAt: number;
  commandType: 'npm-run';
};

export type ProjectFailureClass =
  | 'DEPENDENCY'
  | 'BUILD'
  | 'TEST'
  | 'TYPE'
  | 'PREVIEW'
  | 'UNKNOWN';

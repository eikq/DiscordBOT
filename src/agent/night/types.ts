export const NIGHT_TASK_STATUSES = [
  'READY',
  'IN_PROGRESS',
  'PASS',
  'BLOCKED',
  'NEEDS_HUMAN_VERIFY',
  'SKIPPED',
  'FAILED_LIMIT',
  'BLOCKED_PROVIDER',
] as const;

export type NightTaskStatus = (typeof NIGHT_TASK_STATUSES)[number];

export type NightRisk = 'low' | 'medium' | 'high';

export type NightTask = {
  id: string;
  title: string;
  status: NightTaskStatus;
  nightSafe: boolean;
  priority: number;
  risk: NightRisk;
  goal: string;
  scope: string[];
  acceptanceCommands: string[];
  maxAttempts: number;
  maxMinutes: number;
  maxFilesChanged: number;
  maxDiffBytes: number;
  dependencies: string[];
  requiresHuman: boolean;
  requiresNetwork: boolean;
  requiresSecrets: boolean;
};

export type NightTaskFile = {
  version: 1;
  tasks: NightTask[];
};

export type WorkerProviderKind = 'local-qwen' | 'cursor-cli' | 'scripted';

export type WorkerProviderConfig = {
  id: string;
  kind: WorkerProviderKind;
  enabled: boolean;
  priority: number;
  model?: string;
  outputFormat?: 'stream-json' | 'text';
  freshSessionPerTask?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
  contextTokens?: number;
  keepAlive?: string;
  maxToolRounds?: number;
  temperature?: number;
};

export type ProviderFailureCode =
  | 'quota_exhausted'
  | 'model_unavailable'
  | 'auth_error'
  | 'provider_error';

export type NightQwenConfig = {
  model: string;
  baseUrl: string;
  contextTokens: number;
  keepAlive: string;
  timeoutMs: number;
  maxToolRounds: number;
  temperature: number;
  gpuLayers: number;
};

export type NightConfig = {
  version: 1;
  profile: 'DEV_NIGHT';
  workspaceRoot?: string;
  allowDirtyWorkspace: boolean;
  allowNetwork: boolean;
  allowDependencyInstall: boolean;
  allowGitCommit: boolean;
  ownerApprovedGitCommit: boolean;
  allowGitPush: false;
  allowDestructiveGit: false;
  allowCreateWorktree: boolean;
  controllerRoot?: string;
  workspaceMode: 'primary' | 'isolated-worktree';
  localQwenFallback: boolean;
  codexFallback: boolean;
  stopOnProviderFailure: boolean;
  cursorModel?: string;
  maxRuntimeHours: number;
  maxTasks: number;
  maxAttemptsPerTask: number;
  defaultTaskMaxMinutes: number;
  agentSlots: 1;
  stopAt?: string;
  minDiskFreeBytes: number;
  privatePathDenylist: string[];
  cloudEscalation: { enabled: boolean };
  workerProviders: WorkerProviderConfig[];
  fallbackOn: ProviderFailureCode[];
  qwen: NightQwenConfig;
};

export type SafetyEvent = {
  at: string;
  taskId?: string;
  kind: 'denied_command' | 'denied_path' | 'denied_write' | 'denied_read' | 'policy' | 'provider';
  detail: string;
};

export type TaskAttemptRecord = {
  attempt: number;
  workerId: string;
  providerKind: WorkerProviderKind;
  startedAt: string;
  endedAt: string;
  summary: string;
  toolCalls: number;
  acceptance?: Array<{ command: string; exitCode: number; output: string }>;
  passed: boolean;
  providerFailure?: { code: ProviderFailureCode; message: string };
};

export type TaskRunRecord = {
  taskId: string;
  title: string;
  status: NightTaskStatus;
  attempts: TaskAttemptRecord[];
  filesChanged: string[];
  durationMs: number;
  blockedReason?: string;
  escalationPath?: string;
  workerSummary?: string;
};

export type NightRunState = {
  version: 1;
  runId: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  stopAt?: string;
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'refused';
  workspaceRoot: string;
  branch?: string;
  profile: 'DEV_NIGHT';
  qwenContextTokens: number;
  currentTaskId?: string;
  tasks: Record<string, TaskRunRecord>;
  safetyEvents: SafetyEvent[];
  resourceNotes: string[];
  refusedReason?: string;
  noPushConfirmed: true;
};

export type CommandKind =
  | 'npm_test'
  | 'tsx_test'
  | 'npm_lint'
  | 'tsc_noemit'
  | 'npm_build'
  | 'git_status'
  | 'git_diff'
  | 'git_log';

export type ValidatedCommand = {
  kind: CommandKind;
  executable: string;
  args: string[];
  display: string;
};

export type PolicyDenial = {
  ok: false;
  reason: string;
  kind: SafetyEvent['kind'];
};

export type PolicyAllow<T> = {
  ok: true;
  value: T;
};

export type PolicyResult<T> = PolicyAllow<T> | PolicyDenial;

export function isDenied<T>(result: PolicyResult<T>): result is PolicyDenial {
  return result.ok === false;
}

export const HARD_PRIVATE_PATHS = [
  '.env',
  '.env.*',
  '.runtime/',
  '.venv-*/',
  'data/voice_samples/',
  'data/local_voice/',
  'data/voice/',
  'data/brain/',
  'data/memory/',
  'data/jarvis/',
  'data/jarvis/jarvis.db',
  'data/voice_consents.json',
  'data/personas.json',
] as const;

export const DEFAULT_FALLBACK_ON: ProviderFailureCode[] = [
  'quota_exhausted',
  'model_unavailable',
  'auth_error',
  'provider_error',
];

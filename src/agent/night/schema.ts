import {
  DEFAULT_FALLBACK_ON,
  NIGHT_TASK_STATUSES,
  type NightConfig,
  type NightTask,
  type NightTaskFile,
  type NightTaskStatus,
  type ProviderFailureCode,
  type WorkerProviderConfig,
  type WorkerProviderKind,
} from './types';
import { uniqueDenylist } from './paths';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asInt(value: unknown, fallback: number, min = 1, max = 10_000): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function defaultNightConfig(): NightConfig {
  return {
    version: 1,
    profile: 'DEV_NIGHT',
    allowDirtyWorkspace: false,
    allowNetwork: false,
    allowDependencyInstall: false,
    allowGitCommit: false,
    ownerApprovedGitCommit: false,
    allowGitPush: false,
    allowDestructiveGit: false,
    allowCreateWorktree: false,
    workspaceMode: 'primary',
    localQwenFallback: true,
    codexFallback: false,
    stopOnProviderFailure: false,
    maxRuntimeHours: 6,
    maxTasks: 8,
    maxAttemptsPerTask: 3,
    defaultTaskMaxMinutes: 30,
    agentSlots: 1,
    minDiskFreeBytes: 1_000_000_000,
    privatePathDenylist: uniqueDenylist(),
    cloudEscalation: { enabled: false },
    workerProviders: [{
      id: 'local-qwen',
      kind: 'local-qwen',
      enabled: true,
      priority: 100,
      freshSessionPerTask: true,
    }],
    fallbackOn: [...DEFAULT_FALLBACK_ON],
    qwen: {
      model: process.env.LLM_MODEL || 'digital-me-qwen38:27b-ad-q4km',
      baseUrl: process.env.LLM_NATIVE_URL || 'http://127.0.0.1:11434',
      contextTokens: asInt(process.env.NIGHT_QWEN_CONTEXT_TOKENS, 32768, 2048, 65536),
      keepAlive: process.env.NIGHT_QWEN_KEEP_ALIVE || '30m',
      timeoutMs: asInt(process.env.NIGHT_QWEN_TIMEOUT_MS, 180000, 10_000, 600_000),
      maxToolRounds: 12,
      temperature: 0.1,
      gpuLayers: asInt(process.env.LLM_GPU_LAYERS, 999, 0, 999),
    },
  };
}

function parseProviders(raw: unknown, fallback: WorkerProviderConfig[]): WorkerProviderConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const parsed: WorkerProviderConfig[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const kind = asString(item.kind) as WorkerProviderKind;
    if (kind !== 'local-qwen' && kind !== 'cursor-cli' && kind !== 'scripted') continue;
    parsed.push({
      id: asString(item.id, kind),
      kind,
      enabled: asBool(item.enabled, true),
      priority: asInt(item.priority, 50, 0, 1000),
      model: asString(item.model) || undefined,
      outputFormat: item.outputFormat === 'text' ? 'text' : 'stream-json',
      freshSessionPerTask: asBool(item.freshSessionPerTask, true),
      baseUrl: asString(item.baseUrl) || undefined,
      timeoutMs: typeof item.timeoutMs === 'number' ? item.timeoutMs : undefined,
      contextTokens: typeof item.contextTokens === 'number' ? item.contextTokens : undefined,
      keepAlive: asString(item.keepAlive) || undefined,
      maxToolRounds: typeof item.maxToolRounds === 'number' ? item.maxToolRounds : undefined,
      temperature: typeof item.temperature === 'number' ? item.temperature : undefined,
    });
  }
  return parsed.length ? parsed.sort((a, b) => b.priority - a.priority) : fallback;
}

export function parseNightConfig(raw: unknown): NightConfig {
  const base = defaultNightConfig();
  if (!isRecord(raw)) return base;
  const fallbackOn = Array.isArray(raw.fallbackOn)
    ? raw.fallbackOn.filter((item): item is ProviderFailureCode => (
      item === 'quota_exhausted' || item === 'model_unavailable' || item === 'auth_error' || item === 'provider_error'
    ))
    : base.fallbackOn;
  const qwenRaw = isRecord(raw.qwen) ? raw.qwen : {};
  return {
    ...base,
    workspaceRoot: asString(raw.workspaceRoot) || undefined,
    controllerRoot: asString(raw.controllerRoot) || undefined,
    workspaceMode: asString(raw.workspaceMode) === 'isolated-worktree' ? 'isolated-worktree' : 'primary',
    localQwenFallback: asBool(raw.localQwenFallback, base.localQwenFallback),
    codexFallback: false,
    stopOnProviderFailure: asBool(raw.stopOnProviderFailure, !asBool(raw.localQwenFallback, base.localQwenFallback)),
    cursorModel: asString(raw.cursorModel) || undefined,
    allowCreateWorktree: asBool(raw.allowCreateWorktree, false),
    allowDirtyWorkspace: asBool(raw.allowDirtyWorkspace, false),
    allowNetwork: asBool(raw.allowNetwork, false),
    allowDependencyInstall: asBool(raw.allowDependencyInstall, false),
    allowGitCommit: asBool(raw.allowGitCommit, false),
    ownerApprovedGitCommit: asBool(raw.ownerApprovedGitCommit, false),
    maxRuntimeHours: asInt(raw.maxRuntimeHours, base.maxRuntimeHours, 1, 16),
    maxTasks: asInt(raw.maxTasks, base.maxTasks, 1, 50),
    maxAttemptsPerTask: asInt(raw.maxAttemptsPerTask, base.maxAttemptsPerTask, 1, 5),
    defaultTaskMaxMinutes: asInt(raw.defaultTaskMaxMinutes, base.defaultTaskMaxMinutes, 5, 180),
    stopAt: asString(raw.stopAt) || undefined,
    minDiskFreeBytes: asInt(raw.minDiskFreeBytes, base.minDiskFreeBytes, 100_000_000, 50_000_000_000),
    privatePathDenylist: uniqueDenylist(asStringArray(raw.privatePathDenylist)),
    cloudEscalation: { enabled: false },
    workerProviders: parseProviders(raw.workerProviders, base.workerProviders),
    fallbackOn: asBool(raw.localQwenFallback, base.localQwenFallback) ? (fallbackOn.length ? fallbackOn : base.fallbackOn) : [],
    qwen: {
      ...base.qwen,
      model: asString(qwenRaw.model, base.qwen.model),
      baseUrl: asString(qwenRaw.baseUrl, base.qwen.baseUrl).replace(/\/$/, ''),
      contextTokens: asInt(qwenRaw.contextTokens, base.qwen.contextTokens, 2048, 65536),
      keepAlive: asString(qwenRaw.keepAlive, base.qwen.keepAlive),
      timeoutMs: asInt(qwenRaw.timeoutMs, base.qwen.timeoutMs, 10_000, 600_000),
      maxToolRounds: asInt(qwenRaw.maxToolRounds, base.qwen.maxToolRounds, 2, 24),
      temperature: typeof qwenRaw.temperature === 'number' ? qwenRaw.temperature : base.qwen.temperature,
      gpuLayers: asInt(qwenRaw.gpuLayers, base.qwen.gpuLayers, 0, 999),
    },
  };
}

export function parseNightTask(raw: unknown, defaults: { maxAttempts: number; maxMinutes: number }): NightTask {
  if (!isRecord(raw)) throw new Error('Task must be an object.');
  const id = asString(raw.id).trim();
  const title = asString(raw.title).trim();
  const goal = asString(raw.goal).trim();
  const scope = asStringArray(raw.scope);
  const acceptanceCommands = asStringArray(raw.acceptanceCommands);
  const status = asString(raw.status, 'READY') as NightTaskStatus;
  if (!id) throw new Error('Task id is required.');
  if (!title) throw new Error('Task ' + id + ' is missing title.');
  if (!goal) throw new Error('Task ' + id + ' is missing goal.');
  if (scope.length === 0) throw new Error('Task ' + id + ' must declare scope.');
  if (acceptanceCommands.length === 0) throw new Error('Task ' + id + ' must declare acceptanceCommands.');
  if (!NIGHT_TASK_STATUSES.includes(status)) throw new Error('Task ' + id + ' has invalid status.');
  const risk = asString(raw.risk, 'low');
  if (risk !== 'low' && risk !== 'medium' && risk !== 'high') throw new Error('Task ' + id + ' has invalid risk.');
  return {
    id,
    title,
    status,
    nightSafe: asBool(raw.nightSafe, false),
    priority: asInt(raw.priority, 100, 0, 10_000),
    risk,
    goal,
    scope,
    acceptanceCommands,
    maxAttempts: asInt(raw.maxAttempts, defaults.maxAttempts, 1, 5),
    maxMinutes: asInt(raw.maxMinutes, defaults.maxMinutes, 1, 180),
    maxFilesChanged: asInt(raw.maxFilesChanged, 6, 1, 40),
    maxDiffBytes: asInt(raw.maxDiffBytes, 80_000, 1000, 2_000_000),
    dependencies: asStringArray(raw.dependencies),
    requiresHuman: asBool(raw.requiresHuman, false),
    requiresNetwork: asBool(raw.requiresNetwork, false),
    requiresSecrets: asBool(raw.requiresSecrets, false),
  };
}

export function parseNightTaskFile(raw: unknown, defaults: { maxAttempts: number; maxMinutes: number }): NightTaskFile {
  if (!isRecord(raw) || Number(raw.version) !== 1 || !Array.isArray(raw.tasks)) {
    throw new Error('tasks.json must be { version: 1, tasks: [] }.');
  }
  const tasks = raw.tasks.map((item) => parseNightTask(item, defaults));
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) throw new Error('Duplicate task id: ' + task.id);
    ids.add(task.id);
  }
  return { version: 1, tasks };
}
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { readBatteryStatus, type BatterySnapshot } from '../capabilities/actions/batteryStatus';
import { readNetworkStatus, type NetworkSnapshot } from '../capabilities/actions/networkStatus';

const execFileAsync = promisify(execFile);

/**
 * Real host telemetry for the lab operations panel.
 * Every section is optional: when a source is unavailable the field is
 * omitted (the UI renders "unavailable") — nothing is invented.
 */

export type SystemHealthSnapshot = {
  at: number;
  cpu?: { usagePct: number; cores: number };
  ram?: { totalMb: number; freeMb: number; usedPct: number };
  disk?: { totalGb: number; freeGb: number; usedPct: number };
  gpu?: {
    name: string;
    utilizationPct?: number;
    vramUsedMb?: number;
    vramTotalMb?: number;
  };
  gpuUnavailableReason?: string;
  battery?: BatterySnapshot;
  network?: NetworkSnapshot;
  process: { rssMb: number; uptimeSec: number };
};

type CpuSample = { idle: number; total: number; at: number };

let lastCpuSample: CpuSample | null = null;
let gpuCache: { at: number; value: SystemHealthSnapshot['gpu']; reason?: string } | null = null;
let gpuFailedUntil = 0;

function sampleCpu(): CpuSample {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  return { idle, total, at: Date.now() };
}

function cpuUsage(): SystemHealthSnapshot['cpu'] | undefined {
  const current = sampleCpu();
  const previous = lastCpuSample;
  lastCpuSample = current;
  if (!previous || current.total <= previous.total) return undefined;
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) return undefined;
  const usage = Math.min(100, Math.max(0, (1 - idleDelta / totalDelta) * 100));
  return { usagePct: Math.round(usage * 10) / 10, cores: os.cpus().length };
}

async function diskUsage(): Promise<SystemHealthSnapshot['disk'] | undefined> {
  try {
    const stat = await fs.promises.statfs(process.cwd());
    const total = stat.blocks * stat.bsize;
    const free = stat.bfree * stat.bsize;
    if (!Number.isFinite(total) || total <= 0) return undefined;
    return {
      totalGb: Math.round(total / 1e9),
      freeGb: Math.round(free / 1e9),
      usedPct: Math.round(((total - free) / total) * 1000) / 10,
    };
  } catch {
    return undefined;
  }
}

async function gpuUsage(): Promise<{ gpu?: SystemHealthSnapshot['gpu']; reason?: string }> {
  const now = Date.now();
  if (gpuCache && now - gpuCache.at < 5_000) return { gpu: gpuCache.value, reason: gpuCache.reason };
  if (now < gpuFailedUntil) return { reason: gpuCache?.reason || 'nvidia-smi unavailable' };
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=name,utilization.gpu,memory.used,memory.total',
      '--format=csv,noheader,nounits',
    ], { timeout: 2_000, windowsHide: true });
    const line = stdout.split(/\r?\n/).map(item => item.trim()).find(Boolean);
    if (!line) throw new Error('nvidia-smi returned no GPUs');
    const [name, util, used, total] = line.split(',').map(item => item.trim());
    const value: SystemHealthSnapshot['gpu'] = {
      name: name || 'GPU',
      ...(Number.isFinite(Number(util)) ? { utilizationPct: Number(util) } : {}),
      ...(Number.isFinite(Number(used)) ? { vramUsedMb: Number(used) } : {}),
      ...(Number.isFinite(Number(total)) ? { vramTotalMb: Number(total) } : {}),
    };
    gpuCache = { at: now, value };
    return { gpu: value };
  } catch (error) {
    const reason = `GPU telemetry unavailable (${error instanceof Error ? error.message.split('\n')[0] : 'nvidia-smi failed'})`;
    gpuCache = { at: now, value: undefined, reason };
    gpuFailedUntil = now + 60_000;
    return { reason };
  }
}

export async function systemHealthSnapshot(): Promise<SystemHealthSnapshot> {
  let cpu = cpuUsage();
  if (!cpu) {
    await new Promise(resolve => setTimeout(resolve, 80));
    cpu = cpuUsage();
  }
  const [disk, gpu, battery] = await Promise.all([diskUsage(), gpuUsage(), readBatteryStatus()]);
  const network = readNetworkStatus();
  const totalMb = Math.round(os.totalmem() / 1_048_576);
  const freeMb = Math.round(os.freemem() / 1_048_576);
  return {
    at: Date.now(),
    ...(cpu ? { cpu } : {}),
    ram: {
      totalMb,
      freeMb,
      usedPct: totalMb > 0 ? Math.round(((totalMb - freeMb) / totalMb) * 1000) / 10 : 0,
    },
    ...(disk ? { disk } : {}),
    ...(gpu.gpu ? { gpu: gpu.gpu } : {}),
    ...(gpu.reason ? { gpuUnavailableReason: gpu.reason } : {}),
    battery,
    network,
    process: {
      rssMb: Math.round(process.memoryUsage.rss() / 1_048_576),
      uptimeSec: Math.round(process.uptime()),
    },
  };
}

export type NightAgentSnapshot = {
  available: boolean;
  reason?: string;
  status?: string;
  runId?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
  workspaceRoot?: string;
  provider?: string;
  model?: string;
  currentTaskId?: string;
  counts?: { total: number; pass: number; blocked: number; other: number };
  tasks?: Array<{
    id: string;
    title: string;
    status: string;
    attempts: number;
    filesChanged: number;
  }>;
};

type NightStateFile = {
  runId?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  updatedAt?: string;
  workspaceRoot?: string;
  currentTaskId?: string;
  tasks?: Record<string, {
    taskId?: string;
    title?: string;
    status?: string;
    attempts?: Array<unknown>;
    filesChanged?: string[];
  }>;
};

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function nightAgentSnapshot(cwd = process.cwd()): NightAgentSnapshot {
  const config = readJson<{ workspaceRoot?: string; cursorModel?: string; workerProviders?: Array<{ kind?: string }> }>(
    path.join(cwd, 'night-agent.config.json'),
  );
  const candidates = [
    ...(config?.workspaceRoot ? [path.resolve(config.workspaceRoot)] : []),
    cwd,
  ];
  let picked: { state: NightStateFile; root: string } | undefined;
  for (const root of candidates) {
    const state = readJson<NightStateFile>(path.join(root, '.agent', 'night', 'state.json'));
    if (!state) continue;
    if (!picked || String(state.updatedAt || '') > String(picked.state.updatedAt || '')) {
      picked = { state, root };
    }
  }
  if (!picked) {
    return { available: false, reason: 'No night-agent state file found.' };
  }
  const tasks = Object.values(picked.state.tasks || {}).map(task => ({
    id: String(task.taskId || 'unknown'),
    title: String(task.title || ''),
    status: String(task.status || 'UNKNOWN'),
    attempts: Array.isArray(task.attempts) ? task.attempts.length : 0,
    filesChanged: Array.isArray(task.filesChanged) ? task.filesChanged.length : 0,
  }));
  const pass = tasks.filter(task => task.status === 'PASS').length;
  const blocked = tasks.filter(task => task.status.startsWith('BLOCKED') || task.status === 'FAILED_LIMIT').length;
  return {
    available: true,
    status: picked.state.status,
    runId: picked.state.runId,
    startedAt: picked.state.startedAt,
    endedAt: picked.state.endedAt,
    updatedAt: picked.state.updatedAt,
    workspaceRoot: picked.state.workspaceRoot || picked.root,
    ...(config?.workerProviders?.length ? { provider: config.workerProviders.map(item => String(item.kind || '')).filter(Boolean).join(',') } : {}),
    ...(config?.cursorModel ? { model: config.cursorModel } : {}),
    currentTaskId: picked.state.currentTaskId,
    counts: { total: tasks.length, pass, blocked, other: tasks.length - pass - blocked },
    tasks,
  };
}

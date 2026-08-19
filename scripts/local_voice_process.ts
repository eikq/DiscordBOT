import { ChildProcess, execFileSync, spawn } from 'child_process';
import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

export interface LocalVoiceProcess {
  child: ChildProcess | null;
  reusedExistingService: boolean;
  url: string;
}

const managedChildren = new Set<ChildProcess>();
let shutdownHandlersAttached = false;

function detectedGpuMemoryMiB(): number {
  try {
    const output = execFileSync('nvidia-smi', [
      '--query-gpu=memory.total',
      '--format=csv,noheader,nounits',
    ], { encoding: 'utf8', timeout: 3_000, stdio: ['ignore', 'pipe', 'ignore'] });
    const value = Number(output.trim().split(/\r?\n/u)[0]);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function loadOrCreateLocalToken(projectRoot: string): string {
  const configured = process.env.VOICE_API_TOKEN?.trim();
  if (configured) return configured;

  const tokenPath = path.join(projectRoot, '.runtime', 'voice_api_token');
  if (fs.existsSync(tokenPath)) {
    const saved = fs.readFileSync(tokenPath, 'utf8').trim();
    if (saved.length >= 24) return saved;
  }

  const generated = randomBytes(32).toString('base64url');
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, generated, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

function configureEnvironment(): { python: string; serviceUrl: string } {
  const projectRoot = process.cwd();
  const python = path.join(projectRoot, '.venv-rvc', 'Scripts', 'python.exe');
  const serviceUrl = (process.env.VOICE_SERVICE_URL || 'http://127.0.0.1:8766').replace(/\/$/, '');

  process.env.VOICE_BACKEND = 'local';
  process.env.VOICE_SERVICE_URL = serviceUrl;
  process.env.VOICE_API_TOKEN = loadOrCreateLocalToken(projectRoot);
  process.env.JAITTS_BASE_URL ||= 'http://127.0.0.1:8768';
  process.env.JAITTS_API_TOKEN ||= process.env.VOICE_API_TOKEN;
  process.env.RVC_ROOT ||= path.join(projectRoot, '.runtime', 'Retrieval-based-Voice-Conversion-WebUI');
  process.env.VOICE_DATA_ROOT ||= path.join(projectRoot, 'data', 'local_voice');
  process.env.VOICE_WORK_ROOT ||= path.join(projectRoot, '.runtime', 'voice-work');
  const gpuMemoryMiB = detectedGpuMemoryMiB();
  process.env.RVC_BATCH_SIZE ||= gpuMemoryMiB >= 20_000 ? '8' : gpuMemoryMiB >= 10_000 ? '4' : '2';
  process.env.RVC_WORKERS ||= gpuMemoryMiB >= 20_000 ? '4' : '2';
  process.env.RVC_CPU_THREADS ||= gpuMemoryMiB >= 20_000 ? '8' : '4';

  return { python, serviceUrl };
}

async function readHealth(serviceUrl: string): Promise<{ status?: string; cudaAvailable?: boolean; rvcInstalled?: boolean } | null> {
  try {
    const response = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? await response.json() as { status?: string; cudaAvailable?: boolean; rvcInstalled?: boolean } : null;
  } catch {
    return null;
  }
}

async function authenticationWorks(serviceUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${serviceUrl}/v1/speakers`, {
      headers: { Authorization: `Bearer ${process.env.VOICE_API_TOKEN}` },
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function startLocalVoiceService(): Promise<LocalVoiceProcess> {
  const { python, serviceUrl } = configureEnvironment();
  const existing = await readHealth(serviceUrl);
  if (existing?.status === 'ok') {
    if (!await authenticationWorks(serviceUrl)) {
      throw new Error(`A voice service is already using ${serviceUrl}, but its API token differs. Stop that service before restarting the bot.`);
    }
    console.log(`[VoiceService] Reusing healthy local service at ${serviceUrl}.`);
    return { child: null, reusedExistingService: true, url: serviceUrl };
  }
  if (!fs.existsSync(python) || !fs.statSync(python).isFile()) {
    throw new Error('Local RVC environment is missing. Run `npm run voice:setup` first.');
  }

  const serviceScript = path.join(process.cwd(), 'colab', 'voice_service.py');
  console.log(`[VoiceService] Starting local RTX service at ${serviceUrl}...`);
  const child = spawn(python, [serviceScript], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Local voice service exited with code ${child.exitCode}.`);
    const health = await readHealth(serviceUrl);
    if (health?.status === 'ok') {
      if (!health.rvcInstalled || !health.cudaAvailable) {
        child.kill();
        throw new Error('Local voice service started, but RVC or CUDA is unavailable. Run `npm run voice:setup`.');
      }
      console.log(`[VoiceService] Local CUDA backend is healthy at ${serviceUrl}.`);
      return { child, reusedExistingService: false, url: serviceUrl };
    }
    await new Promise(resolve => setTimeout(resolve, 750));
  }

  child.kill();
  throw new Error('Timed out waiting for the local voice service health check.');
}

export async function warmLocalVoiceService(serviceUrl: string): Promise<boolean> {
  const speakerId = process.env.DEFAULT_SPEAKER_ID?.trim();
  const token = process.env.VOICE_API_TOKEN?.trim();
  if (!speakerId || !token) {
    console.log('[VoiceService] Skipping RVC warm-up because DEFAULT_SPEAKER_ID is not configured.');
    return false;
  }
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    const status = await fetch(`${serviceUrl}/v1/speakers/${encodeURIComponent(speakerId)}`, {
      headers,
      signal: AbortSignal.timeout(5_000),
    });
    if (!status.ok || !(await status.json() as { modelReady?: boolean }).modelReady) {
      console.warn(`[VoiceService] Speaker ${speakerId} has no ready model; skipping RVC warm-up.`);
      return false;
    }
    const startedAt = Date.now();
    console.log(`[VoiceService] Warming the default RVC model for speaker ${speakerId}...`);
    const response = await fetch(`${serviceUrl}/v1/generate`, {
      method: 'POST',
      headers,
      // A full phrase gives RMVPE enough voiced frames and avoids a noisy warm-up traceback.
      body: JSON.stringify({ speakerId, text: 'พร้อมแล้ว วันนี้เล่นเกมกันไหม' }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`warm-up returned ${response.status}`);
    await response.arrayBuffer();
    console.log(`[VoiceService] Default RVC model is warm (${Date.now() - startedAt}ms).`);
    return true;
  } catch (error) {
    console.warn(`[VoiceService] RVC warm-up failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export function attachVoiceServiceShutdown(child: ChildProcess | null): void {
  if (!child) return;
  managedChildren.add(child);
  child.once('exit', () => managedChildren.delete(child));
  if (shutdownHandlersAttached) return;
  shutdownHandlersAttached = true;
  const stopAll = () => {
    for (const managedChild of managedChildren) {
      if (managedChild.exitCode === null) managedChild.kill();
    }
  };
  process.once('exit', stopAll);
  process.once('SIGINT', () => { stopAll(); process.exit(130); });
  process.once('SIGTERM', () => { stopAll(); process.exit(143); });
}

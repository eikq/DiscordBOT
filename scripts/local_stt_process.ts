import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface LocalSttProcess {
  child: ChildProcess | null;
  reusedExistingService: boolean;
  url: string;
}

interface SttHealth {
  status?: string;
  model?: string;
  cudaAvailable?: boolean;
  languages?: string[];
}

async function readHealth(serviceUrl: string): Promise<SttHealth | null> {
  try {
    const response = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? await response.json() as SttHealth : null;
  } catch {
    return null;
  }
}

export async function startLocalSttService(): Promise<LocalSttProcess> {
  const projectRoot = process.cwd();
  const python = path.join(projectRoot, '.venv-stt', 'Scripts', 'python.exe');
  const serviceUrl = (process.env.STT_BASE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
  process.env.STT_PROVIDER = 'local';
  process.env.STT_BASE_URL = serviceUrl;
  process.env.STT_MODEL ||= 'Qwen/Qwen3-ASR-0.6B';

  const existing = await readHealth(serviceUrl);
  if (existing?.status === 'ok') {
    console.log(`[LocalSTT] Reusing ${existing.model || 'local STT'} at ${serviceUrl}.`);
    return { child: null, reusedExistingService: true, url: serviceUrl };
  }
  if (!fs.existsSync(python)) {
    throw new Error('Local STT environment is missing. Run `npm run stt:setup` once.');
  }

  console.log(`[LocalSTT] Loading Thai-English ASR at ${serviceUrl}...`);
  const child = spawn(python, [path.join(projectRoot, 'python', 'local_stt_service.py')], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });

  const deadline = Date.now() + 5 * 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Local STT exited with code ${child.exitCode}.`);
    const health = await readHealth(serviceUrl);
    if (health?.status === 'ok') {
      if (!health.cudaAvailable) {
        child.kill();
        throw new Error('Qwen3-ASR started without CUDA. Run `npm run stt:setup` and check the NVIDIA installation.');
      }
      console.log(`[LocalSTT] ${health.model} is ready with CUDA for Thai and English.`);
      return { child, reusedExistingService: false, url: serviceUrl };
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  child.kill();
  throw new Error('Timed out while loading the local STT model.');
}

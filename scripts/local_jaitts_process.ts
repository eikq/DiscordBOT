import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface LocalJaiTtsProcess {
  child: ChildProcess | null;
  reusedExistingService: boolean;
  url: string;
  ready: boolean;
}

interface JaiTtsHealth {
  status?: string;
  modelReady?: boolean;
  cudaAvailable?: boolean;
  model?: string;
}

async function readHealth(serviceUrl: string): Promise<JaiTtsHealth | null> {
  try {
    const response = await fetch(`${serviceUrl}/health`, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? await response.json() as JaiTtsHealth : null;
  } catch {
    return null;
  }
}

export async function startLocalJaiTtsService(): Promise<LocalJaiTtsProcess> {
  const projectRoot = process.cwd();
  const serviceUrl = (process.env.JAITTS_BASE_URL || 'http://127.0.0.1:8768').replace(/\/$/, '');
  process.env.JAITTS_BASE_URL = serviceUrl;
  if ((process.env.JAITTS_ENABLED || 'true').trim().toLowerCase() === 'false') {
    console.log('[JaiTTS] Expressive Thai source service is disabled; Edge-TTS fallback remains active.');
    return { child: null, reusedExistingService: false, url: serviceUrl, ready: false };
  }

  process.env.JAITTS_API_TOKEN ||= process.env.VOICE_API_TOKEN;
  process.env.HF_HOME ||= path.join(projectRoot, '.runtime', 'huggingface');
  process.env.THONBURIAN_TTS_ROOT ||= path.join(projectRoot, '.runtime', 'thonburian-tts');
  process.env.JAITTS_REFERENCE_ROOT ||= path.join(projectRoot, 'data', 'local_voice', 'speakers');

  const existing = await readHealth(serviceUrl);
  if (existing?.status === 'ok' && existing.modelReady) {
    console.log(`[JaiTTS] Reusing ${existing.model || 'JaiTTS'} at ${serviceUrl}.`);
    return { child: null, reusedExistingService: true, url: serviceUrl, ready: true };
  }

  const python = path.join(projectRoot, '.venv-jaitts', 'Scripts', 'python.exe');
  if (!fs.existsSync(python)) {
    throw new Error('Local JaiTTS environment is missing. Run the JaiTTS setup before enabling it.');
  }
  console.log(`[JaiTTS] Loading expressive Thai source model at ${serviceUrl}...`);
  const child = spawn(python, [path.join(projectRoot, 'python', 'jaitts_service.py')], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`JaiTTS service exited with code ${child.exitCode}.`);
    const health = await readHealth(serviceUrl);
    if (health?.status === 'ok' && health.modelReady) {
      if (!health.cudaAvailable) {
        child.kill();
        throw new Error('JaiTTS started without CUDA.');
      }
      console.log(`[JaiTTS] ${health.model || 'JaiTTS'} is ready on CUDA.`);
      return { child, reusedExistingService: false, url: serviceUrl, ready: true };
    }
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  child.kill();
  throw new Error('Timed out while loading JaiTTS.');
}

import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export interface LocalLlmProcess {
  child: ChildProcess | null;
  reusedExistingService: boolean;
  ready: boolean;
  url: string;
  model: string;
}

function nativeUrl(): string {
  const configured = process.env.LLM_NATIVE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const openAiUrl = process.env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1';
  try {
    const parsed = new URL(openAiUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'http://127.0.0.1:11434';
  }
}

async function serviceIsHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/version`, { signal: AbortSignal.timeout(1_500) });
    return response.ok;
  } catch {
    return false;
  }
}

function findOllama(): string | null {
  const executable = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', executable),
        path.join(process.env.PROGRAMFILES || '', 'Ollama', executable),
      ]
    : ['/usr/local/bin/ollama', '/usr/bin/ollama', path.join(os.homedir(), '.local', 'bin', 'ollama')];
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

async function modelIsInstalled(url: string, model: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return false;
    const payload = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    return (payload.models || []).some(item => item.name === model || item.model === model);
  } catch {
    return false;
  }
}

async function preloadModel(url: string, model: string): Promise<void> {
  const contextTokens = Math.max(512, Number(process.env.LLM_CONTEXT_TOKENS || 2048));
  const gpuLayers = Math.max(0, Number(process.env.LLM_GPU_LAYERS || 0));
  const response = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'ตอบคำเดียว: พร้อม' }],
      stream: false,
      think: false,
      keep_alive: -1,
      options: { num_ctx: contextTokens, num_gpu: gpuLayers, num_predict: 3 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Ollama preload returned ${response.status}`);
}

export async function startLocalLlmService(): Promise<LocalLlmProcess> {
  const url = nativeUrl();
  const model = process.env.LLM_MODEL || 'qwen3:4b-instruct';
  if (process.env.LLM_ENABLED === 'false') {
    return { child: null, reusedExistingService: false, ready: false, url, model };
  }

  let child: ChildProcess | null = null;
  let reusedExistingService = await serviceIsHealthy(url);
  if (!reusedExistingService) {
    const ollama = findOllama();
    if (!ollama) {
      console.warn('[LocalLLM] Ollama is not installed; deterministic responses remain available.');
      return { child: null, reusedExistingService: false, ready: false, url, model };
    }
    console.log(`[LocalLLM] Starting Ollama at ${url}...`);
    child = spawn(ollama, ['serve'], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !await serviceIsHealthy(url)) {
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!await serviceIsHealthy(url)) {
      child.kill();
      console.warn('[LocalLLM] Ollama did not become healthy; deterministic responses remain available.');
      return { child: null, reusedExistingService: false, ready: false, url, model };
    }
  }

  if (!await modelIsInstalled(url, model)) {
    console.warn(`[LocalLLM] Model ${model} is missing. Run \`ollama pull ${model}\`, then restart.`);
    return { child, reusedExistingService, ready: false, url, model };
  }

  console.log(`[LocalLLM] Preloading ${model} with thinking disabled...`);
  try {
    await preloadModel(url, model);
    console.log(`[LocalLLM] ${model} is warm and kept resident for real-time replies.`);
    return { child, reusedExistingService, ready: true, url, model };
  } catch (error) {
    console.warn(`[LocalLLM] Preload failed: ${error instanceof Error ? error.message : String(error)}`);
    return { child, reusedExistingService, ready: false, url, model };
  }
}

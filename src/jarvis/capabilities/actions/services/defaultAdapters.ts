import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalJaiTtsService } from '../../../../../scripts/local_jaitts_process';
import { startLocalSttService } from '../../../../../scripts/local_stt_process';
import { startLocalVoiceService } from '../../../../../scripts/local_voice_process';
import type { JarvisServiceId } from './catalog';
import { probeService, probeServiceFresh } from './health';
import type { ServiceAdapter, ServiceAdapterResult } from './controller';

export function createDefaultServiceAdapters(): Partial<Record<JarvisServiceId, ServiceAdapter>> {
  return {
    ollama: {
      start: startOllamaDaemon,
      stop: child => killChild(child),
    },
    'qwen-asr': {
      start: wrapStarter(() => startLocalSttService()),
      stop: child => killChild(child),
    },
    'jarvis-tts': {
      start: wrapStarter(() => startLocalJaiTtsService()),
      stop: child => killChild(child),
    },
    rvc: {
      start: wrapStarter(() => startLocalVoiceService()),
      stop: child => killChild(child),
    },
  };
}

function wrapStarter(start: () => Promise<{ child: ChildProcess | null }>): () => Promise<ServiceAdapterResult> {
  return async () => {
    try {
      const result = await start();
      return { ok: true, child: result.child, owned: Boolean(result.child) };
    } catch (error) {
      return {
        ok: false,
        errorCode: 'START_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

async function startOllamaDaemon(): Promise<ServiceAdapterResult> {
  const existing = await probeService('ollama');
  if (existing.lifecycle === 'RUNNING') return { ok: true, owned: false };
  const executable = findOllama();
  if (!executable) {
    return { ok: false, errorCode: 'NOT_INSTALLED', message: 'Ollama is not installed.' };
  }
  try {
    const child = spawn(executable, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      shell: false,
    });
    child.unref();
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const probe = await probeServiceFresh('ollama');
      if (probe.lifecycle === 'RUNNING') return { ok: true, child, owned: true };
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { ok: true, child, owned: true };
  } catch (error) {
    return {
      ok: false,
      errorCode: 'START_FAILED',
      message: error instanceof Error ? error.message : String(error),
    };
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

function killChild(child?: ChildProcess): Promise<ServiceAdapterResult> {
  if (!child) return Promise.resolve({ ok: false, errorCode: 'NOT_OWNED', message: 'No owned process.' });
  return new Promise(resolve => {
    let settled = false;
    const finish = (result: ServiceAdapterResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, errorCode: 'TIMEOUT', message: 'Stop timed out.' }), 3_000);
    child.once('exit', () => {
      clearTimeout(timer);
      finish({ ok: true });
    });
    if (!child.kill() && child.exitCode !== null) {
      clearTimeout(timer);
      finish({ ok: true });
    }
  });
}

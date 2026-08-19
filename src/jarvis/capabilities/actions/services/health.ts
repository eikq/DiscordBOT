import type { JarvisServiceHealth, JarvisServiceId, JarvisServiceLifecycle } from './catalog';

export type ServiceProbe = {
  id: JarvisServiceId;
  health: JarvisServiceHealth;
  lifecycle: JarvisServiceLifecycle;
  reason?: string;
};

type CacheEntry = { at: number; value: ServiceProbe };

const cache = new Map<JarvisServiceId, CacheEntry>();
const SERVICE_HEALTH_TTL_MS = 3_000;

export function serviceBaseUrl(id: JarvisServiceId): string {
  if (id === 'ollama') return ollamaNativeUrl();
  if (id === 'qwen-asr') return envUrl('STT_BASE_URL', 'http://127.0.0.1:8765');
  if (id === 'jarvis-tts') return envUrl('JAITTS_BASE_URL', 'http://127.0.0.1:8768');
  if (id === 'rvc') return envUrl('VOICE_SERVICE_URL', 'http://127.0.0.1:8766');
  if (id === 'embedding') return envUrl('EMBEDDING_BASE_URL', 'http://127.0.0.1:8767');
  const port = process.env.PORT || (process.env.JARVIS_STANDALONE === '1' ? '3010' : '3000');
  return `http://127.0.0.1:${port}`;
}

export async function probeService(id: JarvisServiceId, now = Date.now()): Promise<ServiceProbe> {
  const cached = cache.get(id);
  if (cached && now - cached.at < SERVICE_HEALTH_TTL_MS) return cached.value;
  return probeServiceFresh(id, now);
}

export async function probeServiceFresh(id: JarvisServiceId, now = Date.now()): Promise<ServiceProbe> {
  const value = await probeFresh(id);
  cache.set(id, { at: now, value });
  return value;
}

export function clearServiceHealthCache(): void {
  cache.clear();
}

async function probeFresh(id: JarvisServiceId): Promise<ServiceProbe> {
  const url = serviceBaseUrl(id);
  try {
    const path = healthPath(id);
    const response = await fetch(`${url}${path}`, { signal: AbortSignal.timeout(1_500) });
    if (!response.ok) {
      return { id, health: 'offline', lifecycle: 'STOPPED', reason: `HTTP ${response.status}` };
    }
    return { id, health: 'healthy', lifecycle: 'RUNNING' };
  } catch {
    return { id, health: 'offline', lifecycle: 'STOPPED', reason: 'Unreachable' };
  }
}

function healthPath(id: JarvisServiceId): string {
  if (id === 'ollama') return '/api/version';
  if (id === 'jarvis-lab') return '/api/health';
  return '/health';
}

function envUrl(name: string, fallback: string): string {
  return (process.env[name] || fallback).replace(/\/$/, '');
}

function ollamaNativeUrl(): string {
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

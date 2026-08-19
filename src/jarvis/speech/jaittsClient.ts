import { getVoiceServiceApiToken } from '../../bot/voice/VoiceServiceConfig';
import type { SourceTtsResult } from './types';

export function jaittsBaseUrl(): string {
  return (process.env.JAITTS_BASE_URL || 'http://127.0.0.1:8768').replace(/\/$/, '');
}

export async function probeJaitts(timeoutMs = 400): Promise<{ ready: boolean; allocatedVramMb?: number; loadSeconds?: number }> {
  try {
    const response = await fetch(`${jaittsBaseUrl()}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { ready: false };
    const json = await response.json() as {
      status?: string;
      modelReady?: boolean;
      metrics?: { currentAllocatedVramMb?: number; loadSeconds?: number };
    };
    return {
      ready: json.status === 'ok' && json.modelReady === true,
      allocatedVramMb: json.metrics?.currentAllocatedVramMb,
      loadSeconds: json.metrics?.loadSeconds,
    };
  } catch {
    return { ready: false };
  }
}

export async function synthesizeJaitts(text: string, speakerId: string, turnId: string): Promise<SourceTtsResult> {
  const token = (process.env.JAITTS_API_TOKEN || getVoiceServiceApiToken()).trim();
  if (!token) throw new Error('JaiTTS token is not configured.');
  const started = Date.now();
  const response = await fetch(`${jaittsBaseUrl()}/v1/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ text, speakerId, turnId, preset: process.env.JAITTS_PRESET || 'realtime' }),
    signal: AbortSignal.timeout(Number(process.env.JAITTS_TIMEOUT_MS || 60_000)),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`JaiTTS HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return {
    audio: Buffer.from(await response.arrayBuffer()),
    mime: 'audio/wav',
    engine: 'jaitts',
    latencyMs: Date.now() - started,
  };
}

export async function cancelJaitts(turnId: string): Promise<void> {
  const token = (process.env.JAITTS_API_TOKEN || getVoiceServiceApiToken()).trim();
  if (!token) return;
  try {
    await fetch(`${jaittsBaseUrl()}/v1/cancel/${encodeURIComponent(turnId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // best-effort
  }
}

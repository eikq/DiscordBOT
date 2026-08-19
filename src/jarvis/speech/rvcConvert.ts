import { getVoiceServiceApiToken, getVoiceServiceBaseUrl } from '../../bot/voice/VoiceServiceConfig';

export async function probeRvc(timeoutMs = 400): Promise<{ ready: boolean }> {
  const base = getVoiceServiceBaseUrl();
  if (!base) return { ready: false };
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { ready: false };
    const json = await response.json() as { status?: string; rvcInstalled?: boolean };
    return { ready: json.status === 'ok' && json.rvcInstalled === true };
  } catch {
    return { ready: false };
  }
}

export async function convertWithRvc(
  audio: Buffer,
  mime: string,
  speakerId: string,
  turnId: string,
): Promise<{ audio: Buffer; mime: string; latencyMs: number }> {
  const base = getVoiceServiceBaseUrl();
  const token = getVoiceServiceApiToken();
  if (!base || !token) throw new Error('RVC voice service is not configured.');
  const started = Date.now();
  const response = await fetch(`${base}/v1/convert?speakerId=${encodeURIComponent(speakerId)}&mode=speech`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': mime || 'audio/mpeg',
      'X-Jarvis-Turn-Id': turnId,
    },
    body: new Uint8Array(audio),
    signal: AbortSignal.timeout(Number(process.env.VOICE_CONVERT_TIMEOUT_MS || 120_000)),
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 200);
    throw new Error(`RVC HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return {
    audio: Buffer.from(await response.arrayBuffer()),
    mime: response.headers.get('content-type') || 'audio/wav',
    latencyMs: Date.now() - started,
  };
}

export async function cancelRvc(turnId: string): Promise<void> {
  const base = getVoiceServiceBaseUrl();
  const token = getVoiceServiceApiToken();
  if (!base || !token) return;
  try {
    await fetch(`${base}/v1/cancel/${encodeURIComponent(turnId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // best-effort
  }
}

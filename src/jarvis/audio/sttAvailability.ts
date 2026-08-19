export type SttRuntimeProbe = {
  reachable: boolean;
  model?: string;
  baseUrl: string;
  reason?: string;
};

export function getStandaloneSttBaseUrl(): string {
  return process.env.STT_BASE_URL || process.env.COLAB_STT_URL || 'http://127.0.0.1:8765';
}

export async function probeStandaloneStt(timeoutMs = 400): Promise<SttRuntimeProbe> {
  const baseUrl = getStandaloneSttBaseUrl().replace(/\/$/, '');
  try {
    const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { reachable: false, baseUrl, reason: `STT HTTP ${response.status}` };
    }
    const payload = await response.json() as { model?: string; status?: string };
    return {
      reachable: true,
      baseUrl,
      model: typeof payload.model === 'string' ? payload.model : undefined,
    };
  } catch {
    return {
      reachable: false,
      baseUrl,
      reason: 'Qwen3-ASR is not reachable.',
    };
  }
}

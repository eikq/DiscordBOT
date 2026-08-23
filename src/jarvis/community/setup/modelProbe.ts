const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export type ModelProbeResult = {
  ok: boolean;
  loopback: boolean;
  modelIds: string[];
  errorTh?: string;
  errorEn?: string;
};

export function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return LOOPBACK.has(url.hostname.replace(/^\[|\]$/g, '').toLowerCase());
  } catch {
    return false;
  }
}

export async function probeOpenAiCompatibleEndpoint(input: {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}): Promise<ModelProbeResult> {
  if (!isLoopbackHttpUrl(input.baseUrl)) {
    return {
      ok: false,
      loopback: false,
      modelIds: [],
      errorTh: 'เชื่อมต่อได้เฉพาะเครื่องนี้ (127.0.0.1) เท่านั้น',
      errorEn: 'Only this computer (127.0.0.1) can be used as the model server.',
    };
  }
  const base = input.baseUrl.replace(/\/+$/, '');
  const url = `${base}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 4000);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (input.apiKey) headers.Authorization = `Bearer ${input.apiKey}`;
    const reply = await fetch(url, { signal: controller.signal, headers });
    if (!reply.ok) {
      return {
        ok: false,
        loopback: true,
        modelIds: [],
        errorTh: `เซิร์ฟเวอร์ตอบ ${reply.status}`,
        errorEn: `Server responded ${reply.status}`,
      };
    }
    const body = await reply.json() as { data?: Array<{ id?: string }> };
    const modelIds = (body.data || []).map(item => item.id).filter((id): id is string => Boolean(id));
    return { ok: true, loopback: true, modelIds };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      loopback: true,
      modelIds: [],
      errorTh: aborted ? 'หมดเวลารอเซิร์ฟเวอร์โมเดล' : 'เชื่อมต่อเซิร์ฟเวอร์โมเดลไม่ได้',
      errorEn: aborted ? 'The model server timed out.' : 'Could not reach the model server.',
    };
  } finally {
    clearTimeout(timer);
  }
}

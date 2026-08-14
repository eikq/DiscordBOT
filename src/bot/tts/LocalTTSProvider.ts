import { TTSProsody, TTSProvider } from './TTSProvider';
import fs from 'fs';
import path from 'path';
import { getVoiceServiceApiToken, getVoiceServiceBaseUrl } from '../voice/VoiceServiceConfig';

export class LocalTTSProvider implements TTSProvider {
  private baseUrl: string;
  private dict: Record<string, string> = {};
  private activeRequests = new Map<string, AbortController>();

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl || getVoiceServiceBaseUrl() || 'http://127.0.0.1:8766').replace(/\/$/, '');
    this.loadPronunciationDict();
  }

  private loadPronunciationDict() {
    try {
      const p = path.join(process.cwd(), 'data', 'language', 'pronunciation_dict.json');
      if (fs.existsSync(p)) {
        this.dict = JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch (e) {
      // Ignore
    }
  }

  public preprocessText(text: string): string {
    let processed = text;
    const entries = Object.entries(this.dict).sort(([left], [right]) => right.length - left.length);
    for (const [key, val] of entries) {
      if (!key) continue;
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const leftBoundary = /^[A-Za-z0-9]/.test(key) ? '(?<![A-Za-z0-9])' : '';
      const rightBoundary = /[A-Za-z0-9]$/.test(key) ? '(?![A-Za-z0-9])' : '';
      const reg = new RegExp(`${leftBoundary}${escaped}${rightBoundary}`, 'giu');
      processed = processed.replace(reg, val);
    }
    return processed;
  }

  public async synthesize(text: string, speakerName?: string, prosody?: TTSProsody): Promise<Buffer | null> {
    const cleanText = this.preprocessText(text);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    // The RVC service is local by default; the old Colab backend remains an explicit compatibility option.
    try {
      const serviceUrl = this.baseUrl;
      if (!speakerName) {
        console.warn('[LocalTTS] Refusing to select an arbitrary cloned voice without a consented Discord user ID.');
        return null;
      }
      const apiToken = getVoiceServiceApiToken();
      const parsedTimeout = Number(process.env.TTS_TIMEOUT_MS || 60_000);
      const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 60_000;
      const turnId = prosody?.turnId;
      const controller = new AbortController();
      if (turnId) this.activeRequests.set(turnId, controller);
      timeout = setTimeout(() => controller.abort(new Error('TTS request timed out')), timeoutMs);
      const res = await fetch(`${serviceUrl.replace(/\/$/, '')}/v1/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
        },
        body: JSON.stringify({ 
          text: cleanText,
          speakerId: speakerName || 'default',
          tone: prosody?.tone || '',
          action: prosody?.action || '',
          speechAct: prosody?.speechAct || '',
          emotion: prosody?.emotion || prosody?.tone || '',
          intensity: prosody?.intensity,
          pace: prosody?.pace,
          energy: prosody?.energy,
          variation: prosody?.variation,
          variationSeed: prosody?.variationSeed,
          context: prosody?.context?.slice(-300) || '',
          modelSelection: prosody?.modelSelection,
          turnId,
        }),
        signal: controller.signal,
      });

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
    } catch (e) {
      // Aborted turns are expected during voice-chat barge-in.
      cancelled = e instanceof Error && (e.name === 'AbortError' || /abort/i.test(e.message));
      if (!cancelled) {
        console.warn(`[LocalTTS] Request failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      const turnId = prosody?.turnId;
      if (turnId) this.activeRequests.delete(turnId);
    }

    if (cancelled) return null;
    console.warn(`[LocalTTS] No cloned speech service available at ${this.baseUrl}.`);
    return null;
  }

  public async cancel(turnId: string): Promise<void> {
    this.activeRequests.get(turnId)?.abort();
    this.activeRequests.delete(turnId);
    const apiToken = getVoiceServiceApiToken();
    try {
      await fetch(`${this.baseUrl}/v1/cancel/${encodeURIComponent(turnId)}`, {
        method: 'POST',
        headers: apiToken ? { Authorization: `Bearer ${apiToken}` } : {},
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      // Cancellation remains best-effort if the local service is shutting down.
    }
  }
}

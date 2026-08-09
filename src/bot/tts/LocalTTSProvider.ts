import { TTSProvider } from './TTSProvider';
import fs from 'fs';
import path from 'path';

export class LocalTTSProvider implements TTSProvider {
  private baseUrl: string;
  private dict: Record<string, string> = {};

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.TTS_BASE_URL || 'http://127.0.0.1:8766';
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
    for (const [key, val] of Object.entries(this.dict)) {
      const reg = new RegExp(key, 'gi');
      processed = processed.replace(reg, val);
    }
    return processed;
  }

  public async synthesize(text: string, speakerName?: string): Promise<Buffer | null> {
    const cleanText = this.preprocessText(text);

    // Try the authenticated Colab RVC service first, otherwise the configured local TTS server.
    try {
      const colabUrl = process.env.COLAB_VOICE_URL || process.env.COLAB_TTS_URL;
      if (colabUrl && !speakerName) {
        console.warn('[LocalTTS] Refusing to select an arbitrary cloned voice without a consented Discord user ID.');
        return null;
      }
      const serviceUrl = colabUrl || this.baseUrl;
      const route = colabUrl ? '/v1/generate' : '/generate';
      const apiToken = process.env.COLAB_API_TOKEN?.trim();
      const parsedTimeout = Number(process.env.TTS_TIMEOUT_MS || 60_000);
      const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 60_000;
      const res = await fetch(`${serviceUrl.replace(/\/$/, '')}${route}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(colabUrl && apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
        },
        body: JSON.stringify({ 
          text: cleanText,
          speakerId: speakerName || 'default',
        }),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
    } catch (e) {
      // Local TTS endpoint offline
    }

    console.warn(`[LocalTTS] No cloned speech service available at ${process.env.COLAB_VOICE_URL || process.env.COLAB_TTS_URL || this.baseUrl}.`);
    return null;
  }
}

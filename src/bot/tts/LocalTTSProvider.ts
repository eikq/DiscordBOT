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

    // 1. Try Local TTS Server / Colab RVC endpoint
    try {
      const colabUrl = process.env.COLAB_TTS_URL || this.baseUrl;
      const res = await fetch(`${colabUrl.replace(/\/$/, '')}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: cleanText,
          speaker: speakerName || "default",
          voice: speakerName || "default"
        }),
        signal: AbortSignal.timeout(5000)
      });

      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
    } catch (e) {
      // Local TTS endpoint offline
    }

    // 2. Synthesize lightweight local WAV PCM tone fallback for testing without external API
    return this.generateFallbackPCM(cleanText);
  }

  private generateFallbackPCM(text: string): Buffer {
    // Generate a clean 16kHz PCM audio buffer corresponding to speech duration
    const sampleRate = 16000;
    const durationSec = Math.max(0.6, Math.min(3.0, text.length * 0.15));
    const totalSamples = Math.floor(sampleRate * durationSec);
    const buffer = Buffer.alloc(totalSamples * 2);

    const freq = 440; // Gentle reference audio pitch tone
    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      const sample = Math.sin(2 * Math.PI * freq * t) * 0.1 * 32767;
      buffer.writeInt16LE(Math.floor(sample), i * 2);
    }

    return buffer;
  }
}

import { SpeechStream, SpeechToTextProvider, STTStreamOptions } from './SpeechToTextProvider';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';

export class LocalSpeechStream extends SpeechStream {
  private static geminiCooldownUntil = 0;
  private static offlineWarningShown = false;
  private options: STTStreamOptions;
  private pcmChunks: Buffer[] = [];
  private totalBytes = 0;
  private baseUrl: string;
  private dictionary: { people: string[]; games: string[]; slang: string[] } = { people: [], games: [], slang: [] };

  constructor(options: STTStreamOptions, baseUrl: string = 'http://127.0.0.1:8765') {
    super();
    this.options = options;
    this.baseUrl = baseUrl;
    this.loadCustomDictionary();
  }

  private loadCustomDictionary() {
    try {
      const dictPath = path.join(process.cwd(), 'data', 'language', 'custom_dictionary.json');
      if (fs.existsSync(dictPath)) {
        this.dictionary = JSON.parse(fs.readFileSync(dictPath, 'utf-8'));
      }
    } catch (e) {
      // Ignore
    }
  }

  public write(pcmBuffer: Buffer) {
    this.pcmChunks.push(pcmBuffer);
    this.totalBytes += pcmBuffer.length;

    // Trigger local partial event periodically if enough PCM frames accumulated (>0.8s)
    if (this.totalBytes > 150000 && this.pcmChunks.length % 10 === 0) {
      this.emit('partial', 'กำลังฟัง...', 0.7);
    }
  }

  public async endStream() {
    // Ignore audio shorter than ~0.4s (76,800 bytes) as mic clicks or breath noise
    if (this.totalBytes < 76800) {
      this.emit('end');
      return;
    }

    const fullBuffer = Buffer.concat(this.pcmChunks);
    const startTime = Date.now();

    // Build 44-byte WAV Header (48000Hz, 2 channel, 16bit PCM)
    const wavHeader = Buffer.alloc(44);
    const dataSize = fullBuffer.length;
    wavHeader.write('RIFF', 0);
    wavHeader.writeUInt32LE(36 + dataSize, 4);
    wavHeader.write('WAVE', 8);
    wavHeader.write('fmt ', 12);
    wavHeader.writeUInt32LE(16, 16);
    wavHeader.writeUInt16LE(1, 20);
    wavHeader.writeUInt16LE(2, 22);
    wavHeader.writeUInt32LE(48000, 24);
    wavHeader.writeUInt32LE(48000 * 4, 28);
    wavHeader.writeUInt16LE(4, 32);
    wavHeader.writeUInt16LE(16, 34);
    wavHeader.write('data', 36);
    wavHeader.writeUInt32LE(dataSize, 40);

    const wavBuffer = Buffer.concat([wavHeader, fullBuffer]);

    // 1. TRY GEMINI 3.6 FLASH FOR HIGH-ACCURACY THAI & ENGLISH TRANSCRIPTION
    if (process.env.GEMINI_API_KEY && Date.now() > LocalSpeechStream.geminiCooldownUntil && this.totalBytes > 16000) {
      try {
        const ai = new GoogleGenAI({
          apiKey: process.env.GEMINI_API_KEY,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build'
            }
          }
        });
        const response = await ai.models.generateContent({
          model: 'gemini-3.6-flash',
          contents: [
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: wavBuffer.toString('base64')
              }
            },
            {
              text: `Transcribe the spoken audio precisely in Thai and English (Code-switching, Discord gaming slang like valo, minecraft, มึง, กู, 555, eikq, ok, yes). 
Return ONLY the exact transcribed words spoken in Thai and/or English. If it is only background noise, breath, or static, return an empty string.`
            }
          ]
        });

        const text = response.text?.trim() || '';
        const latencyMs = Date.now() - startTime;
        if (text && text.length > 0) {
          const normalized = this.normalizeWithDict(text);
          console.log(`[Gemini STT] 🎙️ Transcribed Thai/EN (${latencyMs}ms): "${normalized}"`);
          this.emit('final', normalized, 0.95, latencyMs);
          this.emit('end');
          return;
        }
      } catch (geminiErr: any) {
        const errStr = String(geminiErr?.message || geminiErr);
        if (errStr.includes('429') || errStr.includes('RESOURCE_EXHAUSTED')) {
          console.warn('[Gemini STT Rate Limit] Rate limit reached. Cooldown enabled for 60s. Switching to Colab/Local ASR.');
          LocalSpeechStream.geminiCooldownUntil = Date.now() + 60000;
        } else {
          console.error('[Gemini STT Warning]', errStr);
        }
      }
    }

    // 2. FALLBACK TO LOCAL STT / COLAB TRANSCRIPTION ENDPOINT
    try {
      const sttUrl = process.env.COLAB_STT_URL || this.baseUrl;
      const response = await fetch(`${sttUrl.replace(/\/$/, '')}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: fullBuffer,
        signal: AbortSignal.timeout(4000)
      });

      if (response.ok) {
        const json = await response.json();
        const latencyMs = Date.now() - startTime;
        let rawText = json.text || '';
        const normalizedText = this.normalizeWithDict(rawText);
        this.emit('final', normalizedText, json.confidence || 0.92, latencyMs);
      } else {
        throw new Error(`Local STT status ${response.status}`);
      }
    } catch (err: any) {
      // A duration estimate is not a transcript. Stay silent until a real STT
      // provider is available so the bot never reacts to fabricated words.
      if (!LocalSpeechStream.offlineWarningShown) {
        console.warn(`[LocalSTT] No transcription service available at ${this.baseUrl}.`);
        LocalSpeechStream.offlineWarningShown = true;
      }
    } finally {
      this.pcmChunks = [];
      this.totalBytes = 0;
      this.emit('end');
    }
  }

  private normalizeWithDict(text: string): string {
    let result = text;
    for (const game of this.dictionary.games || []) {
      if (game.toLowerCase() === 'valorant') result = result.replace(/วาโล|valo/gi, 'Valorant');
      if (game.toLowerCase() === 'minecraft') result = result.replace(/มายคราฟ|mc/gi, 'Minecraft');
    }
    return result;
  }
}

export class LocalSTTProvider implements SpeechToTextProvider {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.STT_BASE_URL || 'http://127.0.0.1:8765';
  }

  createStream(options: STTStreamOptions): SpeechStream {
    return new LocalSpeechStream(options, this.baseUrl);
  }
}

import { SpeechStream, SpeechToTextProvider, STTStreamOptions } from './SpeechToTextProvider';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import { transcriptHallucinationReason } from './TranscriptQuality';

export class LocalSpeechStream extends SpeechStream {
  private static geminiCooldownUntil = 0;
  private static offlineWarningShown = false;
  private options: STTStreamOptions;
  private pcmChunks: Buffer[] = [];
  private totalBytes = 0;
  private baseUrl: string;
  private dictionary: {
    people: string[];
    games: string[];
    slang: string[];
    corrections?: Record<string, string[]>;
  } = { people: [], games: [], slang: [] };

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

    // Disabled by default: a listening indicator must never be mistaken for recognized speech.
    if (process.env.STT_EMIT_LISTENING_PARTIAL === 'true' && this.totalBytes > 150000 && this.pcmChunks.length % 10 === 0) {
      this.emit('partial', 'กำลังฟัง...', 0.7);
    }
  }

  public discard(): void {
    this.pcmChunks = [];
    this.totalBytes = 0;
    super.discard();
  }

  public async endStream() {
    // Keep very short clicks out, while allowing brief Thai acknowledgements and names.
    const configuredMinimumMs = Number(process.env.STT_MIN_AUDIO_MS || 250);
    const minimumAudioMs = Number.isFinite(configuredMinimumMs)
      ? Math.min(1_000, Math.max(150, configuredMinimumMs))
      : 250;
    const minimumAudioBytes = Math.round(48_000 * 2 * 2 * minimumAudioMs / 1_000);
    if (this.totalBytes < minimumAudioBytes) {
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

    // Gemini is used only when explicitly selected. Local Qwen3-ASR is the private, zero-cost default.
    if (process.env.STT_PROVIDER === 'gemini' && process.env.GEMINI_API_KEY && Date.now() > LocalSpeechStream.geminiCooldownUntil && this.totalBytes > 16000) {
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
          const rejectionReason = this.transcriptRejectionReason(normalized, text, {
            durationSeconds: fullBuffer.length / (48_000 * 2 * 2),
          });
          if (rejectionReason) {
            const debugAudioPath = this.saveRejectedDebugAudio(wavBuffer, rejectionReason);
            this.emit('nonSpeech', {
              subtype: 'NOISE',
              displayText: '[เสียงรบกวน]',
              durationMs: fullBuffer.length / (48_000 * 2 * 2) * 1_000,
              reason: rejectionReason,
              rejectedText: text,
              debugAudioPath,
            });
            this.emit('end');
            return;
          }
          console.log(`[Gemini STT] 🎙️ Transcribed Thai/EN (${latencyMs}ms): "${normalized}"`);
          this.emit('final', normalized, 0.95, latencyMs, {
            detectedLanguage: 'Thai/English', model: 'gemini-3.6-flash', verified: true,
            verificationMethod: 'provider_noise_instruction_and_local_hallucination_guard',
          });
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

    // Local Qwen3-ASR endpoint. The body is 48 kHz stereo signed 16-bit PCM.
    try {
      const sttUrl = process.env.COLAB_STT_URL || this.baseUrl;
      const timeoutMs = Math.max(5_000, Number(process.env.STT_TIMEOUT_MS || 60_000));
      const response = await fetch(`${sttUrl.replace(/\/$/, '')}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: fullBuffer,
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (response.ok) {
        const json = await response.json();
        const latencyMs = Date.now() - startTime;
        const rawText = typeof json.text === 'string' ? json.text : '';
        const diagnostics = json.diagnostics && typeof json.diagnostics === 'object' ? json.diagnostics : {};
        const classification = typeof json.classification === 'string' ? json.classification : '';
        if (classification === 'noise' || json.rejectionReason) {
          const reason = typeof json.rejectionReason === 'string' ? json.rejectionReason : 'non_speech_audio';
          const debugAudioPath = this.saveRejectedDebugAudio(wavBuffer, reason);
          this.emit('nonSpeech', {
            subtype: 'NOISE',
            displayText: typeof json.displayText === 'string' && json.displayText ? json.displayText : '[เสียงรบกวน]',
            durationMs: Number.isFinite(Number(diagnostics.durationSeconds))
              ? Number(diagnostics.durationSeconds) * 1_000
              : fullBuffer.length / (48_000 * 2 * 2) * 1_000,
            rmsDbfs: Number.isFinite(Number(diagnostics.rmsDbfs)) ? Number(diagnostics.rmsDbfs) : undefined,
            reason,
            rejectedText: typeof json.rawText === 'string' ? json.rawText : undefined,
            debugAudioPath,
          });
          console.log(`[LocalSTT] Classified audio as noise (${reason}); transcript was not sent to the brain.`);
          return;
        }
        const normalizedText = this.normalizeWithDict(rawText);
        const localRejectionReason = this.transcriptRejectionReason(normalizedText, rawText, diagnostics);
        if (localRejectionReason) {
          const debugAudioPath = this.saveRejectedDebugAudio(wavBuffer, localRejectionReason);
          this.emit('nonSpeech', {
            subtype: 'NOISE',
            displayText: '[เสียงรบกวน]',
            durationMs: Number.isFinite(Number(diagnostics.durationSeconds))
              ? Number(diagnostics.durationSeconds) * 1_000
              : fullBuffer.length / (48_000 * 2 * 2) * 1_000,
            rmsDbfs: Number.isFinite(Number(diagnostics.rmsDbfs)) ? Number(diagnostics.rmsDbfs) : undefined,
            reason: localRejectionReason,
            rejectedText: rawText,
            debugAudioPath,
          });
          console.log(`[LocalSTT] Rejected suspicious transcript "${rawText}" (${localRejectionReason}).`);
          return;
        }
        const confidence = typeof json.confidence === 'number' ? json.confidence : 0;
        if (normalizedText) this.emit('final', normalizedText, confidence, latencyMs, {
          detectedLanguage: typeof json.language === 'string' ? json.language : undefined,
          model: typeof json.model === 'string' ? json.model : undefined,
          languageFallbackApplied: json.languageFallbackApplied === true,
          verified: json.verified === true,
          verificationMethod: typeof json.verificationMethod === 'string' ? json.verificationMethod : undefined,
          speechConfidence: Number.isFinite(Number(diagnostics.speechConfidence))
            ? Number(diagnostics.speechConfidence)
            : undefined,
        });
        else {
          const duration = Number(diagnostics.durationSeconds);
          const rms = Number(diagnostics.rmsDbfs);
          const detail = Number.isFinite(duration) && Number.isFinite(rms)
            ? ` (${duration.toFixed(2)}s, ${rms.toFixed(1)} dBFS)`
            : '';
          console.log(`[LocalSTT] No recognizable Thai/English speech${detail}.`);
        }
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
      if (this.options.reportFailures) {
        const message = err instanceof Error ? err.message : String(err);
        const timedOut = /timeout|aborted|AbortError/i.test(message);
        this.emit('error', timedOut
          ? Object.assign(new Error('STT timed out'), { code: 'STT_TIMEOUT' })
          : Object.assign(err instanceof Error ? err : new Error(message), { code: 'STT_UNAVAILABLE' }));
      }
    } finally {
      this.pcmChunks = [];
      this.totalBytes = 0;
      this.emit('end');
    }
  }

  private normalizeWithDict(text: string): string {
    let result = text
      .replace(/วาโล(?:แรนต์)?|valorant|valo/giu, 'Valorant')
      .replace(/มายคราฟ(?:ต์)?|minecraft/giu, 'Minecraft')
      .replace(/ดิสคอร์ด|discord/giu, 'Discord');
    for (const game of this.dictionary.games || []) {
      if (game.toLowerCase() === 'valorant') result = result.replace(/วาโล|valo/gi, 'Valorant');
      if (game.toLowerCase() === 'minecraft') result = result.replace(/มายคราฟ|mc/gi, 'Minecraft');
    }
    for (const [canonical, variants] of Object.entries(this.dictionary.corrections || {})) {
      for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
        if (!variant) continue;
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'giu'), ` ${canonical} `);
      }
    }
    return result
      .replace(/\s+/gu, ' ')
      .replace(/\s+([,.!?;:])/gu, '$1')
      .trim();
  }

  private transcriptRejectionReason(
    normalizedText: string,
    rawText: string,
    diagnostics: { durationSeconds?: unknown },
  ): string | null {
    const durationSeconds = Number(diagnostics.durationSeconds);
    return transcriptHallucinationReason(normalizedText, {
      rawText,
      durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
    });
  }

  private saveRejectedDebugAudio(wavBuffer: Buffer, reason: string): string | undefined {
    if (this.options.persistRejectedAudio === false) return undefined;
    if (process.env.STT_SAVE_REJECTED_AUDIO === 'false') return undefined;
    try {
      const directory = path.join(process.cwd(), '.runtime', 'stt-rejected');
      fs.mkdirSync(directory, { recursive: true });
      const safeUser = this.options.userId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'unknown';
      const safeReason = reason.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 50) || 'rejected';
      const outputPath = path.join(directory, `${Date.now()}_${safeUser}_${safeReason}.wav`);
      fs.writeFileSync(outputPath, wavBuffer);

      const oldFiles = fs.readdirSync(directory)
        .filter(file => file.endsWith('.wav'))
        .map(file => ({ file, modified: fs.statSync(path.join(directory, file)).mtimeMs }))
        .sort((left, right) => right.modified - left.modified)
        .slice(40);
      for (const old of oldFiles) fs.rmSync(path.join(directory, old.file), { force: true });
      return outputPath;
    } catch {
      return undefined;
    }
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

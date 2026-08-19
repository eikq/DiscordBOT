import type { SpeechStream, SpeechToTextProvider } from '../../bot/stt/SpeechToTextProvider';
import { standaloneTranscriptIgnoreReason } from './utteranceQuality';

export type StandaloneTranscriptStatus = 'final' | 'ignored' | 'unavailable' | 'timeout' | 'error';

export type StandaloneTranscriptResult = {
  status: StandaloneTranscriptStatus;
  text: string;
  confidence?: number;
  latencyMs: number;
  model?: string;
  reason?: string;
  persisted: false;
};

/**
 * Run one complete utterance through the existing SpeechToTextProvider.
 * Never writes training datasets or rejected-debug WAVs.
 */
export async function transcribeStandaloneUtterance(
  provider: SpeechToTextProvider,
  pcm: Uint8Array,
  options: {
    turnId: string;
    sessionId?: string;
    timeoutMs?: number;
    voicedMs?: number;
    captureDurationMs?: number;
  },
): Promise<StandaloneTranscriptResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? Math.max(5_000, Number(process.env.STT_TIMEOUT_MS || 60_000));
  const stream = provider.createStream({
    userId: 'local-mic',
    username: 'local-mic',
    displayName: 'local-mic',
    sessionId: options.sessionId || 'jarvis-lab',
    persistRejectedAudio: false,
    reportFailures: true,
  });
  return await new Promise(resolve => {
    let settled = false;
    const timer = setTimeout(() => {
      finish({
        status: 'timeout',
        text: '',
        latencyMs: Date.now() - started,
        reason: `STT timed out after ${timeoutMs}ms`,
        persisted: false,
      });
    }, timeoutMs);

    const finish = (result: StandaloneTranscriptResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.discard();
      resolve(result);
    };

    stream.on('final', (text, confidence, latencyMs, metadata) => {
      const trimmed = String(text || '').trim();
      if (!trimmed) {
        finish({
          status: 'ignored',
          text: '',
          latencyMs: latencyMs || Date.now() - started,
          reason: 'empty-transcript',
          persisted: false,
          model: metadata?.model,
        });
        return;
      }
      const ignore = standaloneTranscriptIgnoreReason(trimmed, {
        confidence,
        voicedMs: options.voicedMs,
        captureDurationMs: options.captureDurationMs,
      });
      if (ignore) {
        finish({
          status: 'ignored',
          text: trimmed,
          latencyMs: latencyMs || Date.now() - started,
          reason: ignore,
          persisted: false,
          model: metadata?.model,
        });
        return;
      }
      finish({
        status: 'final',
        text: trimmed,
        confidence,
        latencyMs: latencyMs || Date.now() - started,
        model: metadata?.model,
        persisted: false,
      });
    });
    stream.on('nonSpeech', metadata => {
      finish({
        status: 'ignored',
        text: '',
        latencyMs: Date.now() - started,
        reason: metadata.reason || metadata.subtype || 'non-speech',
        persisted: false,
      });
    });
    stream.on('error', error => {
      const message = error instanceof Error ? error.message : String(error);
      const code = (error as { code?: string }).code;
      const timedOut = code === 'STT_TIMEOUT' || /timeout/i.test(message);
      const unavailable = code === 'STT_UNAVAILABLE' || /ECONNREFUSED|ENOTFOUND|unavailable/i.test(message);
      finish({
        status: timedOut ? 'timeout' : unavailable ? 'unavailable' : 'error',
        text: '',
        latencyMs: Date.now() - started,
        reason: message,
        persisted: false,
      });
    });
    stream.on('end', () => {
      finish({
        status: 'ignored',
        text: '',
        latencyMs: Date.now() - started,
        reason: 'no-transcript',
        persisted: false,
      });
    });

    writePcm(stream, pcm);
    void stream.endStream().catch(error => {
      finish({
        status: 'error',
        text: '',
        latencyMs: Date.now() - started,
        reason: error instanceof Error ? error.message : String(error),
        persisted: false,
      });
    });
  });
}

function writePcm(stream: SpeechStream, pcm: Uint8Array): void {
  const buffer = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const chunkSize = 48_000 * 2 * 2 / 50;
  for (let offset = 0; offset < buffer.length; offset += chunkSize) {
    stream.write(buffer.subarray(offset, Math.min(buffer.length, offset + chunkSize)));
  }
}

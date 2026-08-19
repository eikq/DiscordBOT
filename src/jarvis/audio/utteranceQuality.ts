/**
 * Standalone conversational-utterance filters.
 * Conversational mic audio is not persisted.
 */
const DANGLING_THAI = /(?:ใน|ที่|และ|ของ|จะ|ว่า|กับ|ให้|ไป|มา)$/u;

export function standaloneTranscriptIgnoreReason(text: string, options: {
  confidence?: number;
  voicedMs?: number;
  captureDurationMs?: number;
} = {}): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return 'empty-transcript';
  if (trimmed.length < 2) return 'too-short';
  if (options.voicedMs !== undefined && options.voicedMs < 480) return 'too-short';
  if (
    trimmed.length >= 10
    && DANGLING_THAI.test(trimmed)
    && !/[?？]$/u.test(trimmed)
    && (options.confidence === undefined || options.confidence < 0.92)
  ) {
    return 'incomplete-utterance';
  }
  return undefined;
}

export const STANDALONE_VAD = {
  minimumVoicedMs: 550,
  minimumRmsDbfs: -36,
  endSilenceMs: 750,
  maxCaptureMs: 12_000,
  minimumCaptureMs: 700,
} as const;

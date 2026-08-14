import type { VoiceTranscriptData } from './VoiceDatasetWriter';

export type LearnedVoiceStyle = 'casual' | 'question' | 'excited' | 'soft' | 'annoyed' | 'unknown';

export interface VoiceUtteranceAnalysis {
  schemaVersion: 1;
  analyzedAt: number;
  audio: {
    sampleRate: 48_000;
    channels: 2;
    bitsPerSample: 16;
    durationSeconds: number;
    rmsDbfs: number;
    peak: number;
    clippedPercent: number;
    dcOffset: number;
    speechRatio: number;
    estimatedSnrDb: number;
    silenceThresholdDbfs: number;
  };
  prosody: {
    pitchMedianHz: number | null;
    pitchP10Hz: number | null;
    pitchP90Hz: number | null;
    pitchRangeHz: number | null;
    voicedRatio: number;
    speakingRateWordsPerSecond: number | null;
    pauseCount: number;
    averagePauseMs: number;
    longestPauseMs: number;
    energyVariationDb: number;
    style: LearnedVoiceStyle;
    styleConfidence: number;
  };
  transcript: {
    available: boolean;
    confidence: number | null;
    characterCount: number;
    estimatedWordCount: number;
    hasThai: boolean;
    hasEnglish: boolean;
  };
  quality: {
    score: number;
    acceptedForVoiceTraining: boolean;
    acceptedForExpressiveTts: boolean;
    reasons: string[];
    expressiveTtsReasons: string[];
    suspectedOverlap: boolean;
    speakerVerification: 'discord_ssrc_only';
  };
}

const SAMPLE_RATE = 48_000 as const;
const CHANNELS = 2 as const;
const BYTES_PER_FRAME = CHANNELS * 2;
const ANALYSIS_FRAME_SAMPLES = 960; // 20 ms

export function analyzeVoiceUtterance(
  pcmBuffer: Buffer,
  transcript: VoiceTranscriptData | null,
  options: { suspectedOverlap?: boolean } = {},
): VoiceUtteranceAnalysis {
  const frameCount = Math.floor(pcmBuffer.length / BYTES_PER_FRAME);
  const mono = new Float32Array(frameCount);
  let peak = 0;
  let sum = 0;
  let sumSquares = 0;
  let clipped = 0;

  for (let index = 0; index < frameCount; index++) {
    const offset = index * BYTES_PER_FRAME;
    const left = pcmBuffer.readInt16LE(offset) / 32768;
    const right = pcmBuffer.readInt16LE(offset + 2) / 32768;
    const sample = (left + right) * 0.5;
    mono[index] = sample;
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    sum += sample;
    sumSquares += sample * sample;
    if (absolute >= 0.995) clipped++;
  }

  const durationSeconds = frameCount / SAMPLE_RATE;
  const rms = frameCount ? Math.sqrt(sumSquares / frameCount) : 0;
  const rmsDbfs = amplitudeToDb(rms);
  const dcOffset = frameCount ? sum / frameCount : 0;
  const frameDb = calculateFrameLevels(mono);
  const sortedLevels = [...frameDb].sort((a, b) => a - b);
  const lowLevel = percentile(sortedLevels, 0.2) ?? -96;
  const highLevel = percentile(sortedLevels, 0.8) ?? -96;
  const silenceThresholdDbfs = clamp(lowLevel + 8, -48, -24);
  const lowDynamicRange = highLevel - lowLevel < 3;
  const speechFrames = frameDb.map(level => lowDynamicRange ? rmsDbfs > -45 : level >= silenceThresholdDbfs);
  const speechFrameCount = speechFrames.filter(Boolean).length;
  const speechRatio = frameDb.length ? speechFrameCount / frameDb.length : 0;
  const speechLevels = frameDb.filter((_level, index) => speechFrames[index]);
  const noiseLevels = frameDb.filter((_level, index) => !speechFrames[index]);
  const estimatedSnrDb = noiseLevels.length
    ? clamp((median(speechLevels) ?? rmsDbfs) - (median(noiseLevels) ?? lowLevel), 0, 40)
    : (speechRatio > 0 ? 20 : 0);

  const pauseDurations = calculatePauseDurations(speechFrames);
  const pitch = estimatePitch(mono, durationSeconds);
  const text = transcript?.text.trim() ?? '';
  const estimatedWordCount = estimateWordCount(text);
  const speakingRate = estimatedWordCount > 0 && durationSeconds * speechRatio > 0.25
    ? estimatedWordCount / (durationSeconds * speechRatio)
    : null;
  const energyVariationDb = standardDeviation(speechLevels);
  const style = classifyStyle(text, rmsDbfs, speakingRate, pitch.range, energyVariationDb);

  const reasons: string[] = [];
  if (durationSeconds < 0.8) reasons.push('duration_below_0.8_seconds');
  if (durationSeconds > 30) reasons.push('duration_above_30_seconds');
  if (speechRatio < 0.55) reasons.push('too_little_audible_speech');
  if (rmsDbfs < -38) reasons.push('audio_too_quiet');
  if (rmsDbfs > -7) reasons.push('audio_too_loud');
  if (frameCount > 0 && clipped / frameCount > 0.005) reasons.push('excessive_clipping');
  if (Math.abs(dcOffset) > 0.05) reasons.push('excessive_dc_offset');
  if (estimatedSnrDb < 5) reasons.push('low_estimated_snr');
  // Discord receiver.subscribe(userId) yields that user's isolated Opus stream.
  // Another SSRC speaking at the same time is useful conversation metadata, but
  // it does not place that user's packets in this target WAV. Keep the overlap
  // flag below without rejecting otherwise-clean target audio.

  const expressiveTtsReasons = [...reasons];
  if (!transcript || !text) expressiveTtsReasons.push('transcript_unavailable');
  else if (transcript.confidence < 0.75) expressiveTtsReasons.push('transcript_confidence_below_0.75');
  if (estimatedWordCount < 1) expressiveTtsReasons.push('transcript_too_short');

  const transcriptConfidence = transcript?.confidence ?? 0;
  const score = clamp(
    0.23 * clamp(speechRatio / 0.8, 0, 1)
      + 0.19 * clamp(estimatedSnrDb / 20, 0, 1)
      + 0.14 * clamp((rmsDbfs + 38) / 20, 0, 1)
      + 0.14 * (1 - clamp((frameCount ? clipped / frameCount : 0) / 0.005, 0, 1))
      + 0.1 * (1 - clamp(Math.abs(dcOffset) / 0.05, 0, 1))
      + 0.1 * clamp(durationSeconds / 3, 0, 1)
      + 0.1 * (transcript ? clamp(transcriptConfidence, 0, 1) : 0.5),
    0,
    1,
  );

  return {
    schemaVersion: 1,
    analyzedAt: Date.now(),
    audio: {
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      bitsPerSample: 16,
      durationSeconds: round(durationSeconds, 3),
      rmsDbfs: round(rmsDbfs, 3),
      peak: round(peak, 6),
      clippedPercent: round(frameCount ? clipped / frameCount * 100 : 0, 6),
      dcOffset: round(dcOffset, 6),
      speechRatio: round(speechRatio, 5),
      estimatedSnrDb: round(estimatedSnrDb, 3),
      silenceThresholdDbfs: round(silenceThresholdDbfs, 3),
    },
    prosody: {
      pitchMedianHz: nullableRound(pitch.median, 2),
      pitchP10Hz: nullableRound(pitch.p10, 2),
      pitchP90Hz: nullableRound(pitch.p90, 2),
      pitchRangeHz: nullableRound(pitch.range, 2),
      voicedRatio: round(pitch.voicedRatio, 4),
      speakingRateWordsPerSecond: nullableRound(speakingRate, 3),
      pauseCount: pauseDurations.length,
      averagePauseMs: round(average(pauseDurations), 1),
      longestPauseMs: round(Math.max(0, ...pauseDurations), 1),
      energyVariationDb: round(energyVariationDb, 3),
      style: style.name,
      styleConfidence: round(style.confidence, 3),
    },
    transcript: {
      available: Boolean(transcript && text),
      confidence: transcript ? round(transcript.confidence, 4) : null,
      characterCount: [...text].length,
      estimatedWordCount,
      hasThai: /[\u0E00-\u0E7F]/u.test(text),
      hasEnglish: /[A-Za-z]/u.test(text),
    },
    quality: {
      score: round(score, 4),
      acceptedForVoiceTraining: reasons.length === 0,
      acceptedForExpressiveTts: expressiveTtsReasons.length === 0,
      reasons,
      expressiveTtsReasons,
      suspectedOverlap: Boolean(options.suspectedOverlap),
      speakerVerification: 'discord_ssrc_only',
    },
  };
}

function calculateFrameLevels(mono: Float32Array): number[] {
  const result: number[] = [];
  for (let start = 0; start < mono.length; start += ANALYSIS_FRAME_SAMPLES) {
    const end = Math.min(mono.length, start + ANALYSIS_FRAME_SAMPLES);
    let sumSquares = 0;
    for (let index = start; index < end; index++) sumSquares += mono[index] * mono[index];
    result.push(amplitudeToDb(Math.sqrt(sumSquares / Math.max(1, end - start))));
  }
  return result;
}

function calculatePauseDurations(speechFrames: boolean[]): number[] {
  const result: number[] = [];
  let run = 0;
  let speechSeen = false;
  for (const speech of speechFrames) {
    if (speech) {
      if (speechSeen && run >= 6) result.push(run * 20);
      speechSeen = true;
      run = 0;
    } else if (speechSeen) {
      run++;
    }
  }
  return result;
}

function estimatePitch(mono48k: Float32Array, durationSeconds: number): {
  median: number | null;
  p10: number | null;
  p90: number | null;
  range: number | null;
  voicedRatio: number;
} {
  const downsampleFactor = 6;
  const sampleRate = SAMPLE_RATE / downsampleFactor;
  const maxAnalysisSamples = Math.min(mono48k.length, SAMPLE_RATE * 20);
  const downsampled = new Float32Array(Math.floor(maxAnalysisSamples / downsampleFactor));
  for (let index = 0; index < downsampled.length; index++) {
    let value = 0;
    for (let offset = 0; offset < downsampleFactor; offset++) value += mono48k[index * downsampleFactor + offset];
    downsampled[index] = value / downsampleFactor;
  }

  const windowSize = 320;
  const stepSize = 320;
  const minimumLag = Math.floor(sampleRate / 350);
  const maximumLag = Math.ceil(sampleRate / 70);
  const values: number[] = [];
  let analyzed = 0;
  for (let start = 0; start + windowSize + maximumLag < downsampled.length; start += stepSize) {
    analyzed++;
    let mean = 0;
    for (let index = start; index < start + windowSize; index++) mean += downsampled[index];
    mean /= windowSize;
    let baseEnergy = 0;
    for (let index = start; index < start + windowSize; index++) {
      const sample = downsampled[index] - mean;
      baseEnergy += sample * sample;
    }
    if (baseEnergy / windowSize < 0.00001) continue;

    let bestLag = 0;
    let bestCorrelation = 0;
    for (let lag = minimumLag; lag <= maximumLag; lag++) {
      let correlation = 0;
      let shiftedEnergy = 0;
      for (let offset = 0; offset < windowSize - lag; offset++) {
        const first = downsampled[start + offset] - mean;
        const second = downsampled[start + offset + lag] - mean;
        correlation += first * second;
        shiftedEnergy += second * second;
      }
      const normalized = correlation / Math.sqrt(Math.max(1e-12, baseEnergy * shiftedEnergy));
      if (normalized > bestCorrelation) {
        bestCorrelation = normalized;
        bestLag = lag;
      }
    }
    if (bestLag && bestCorrelation >= 0.35) values.push(sampleRate / bestLag);
  }

  values.sort((a, b) => a - b);
  const p10 = percentile(values, 0.1);
  const p90 = percentile(values, 0.9);
  return {
    median: median(values),
    p10,
    p90,
    range: p10 !== null && p90 !== null ? p90 - p10 : null,
    voicedRatio: durationSeconds > 0 && analyzed > 0 ? values.length / analyzed : 0,
  };
}

function classifyStyle(
  text: string,
  rmsDbfs: number,
  speakingRate: number | null,
  pitchRange: number | null,
  energyVariation: number,
): { name: LearnedVoiceStyle; confidence: number } {
  const lower = text.toLocaleLowerCase();
  if (/[?？]|(?:ไหม|มั้ย|ปะ|เหรอ|หรอ|อะไร|ไหน|ไง|ยัง)\s*$/u.test(lower)) return { name: 'question', confidence: 0.82 };
  if (/(?:หงุดหงิด|แม่ง|เชี่ย|ชิบหาย|wtf)/u.test(lower)) return { name: 'annoyed', confidence: 0.75 };
  if (/[!！]|555+|ฮ่า|เย่|โห|เฮ้ย/u.test(lower) || (pitchRange ?? 0) > 90 || energyVariation > 7) {
    return { name: 'excited', confidence: 0.72 };
  }
  if (rmsDbfs < -27 || (speakingRate !== null && speakingRate < 1.8)) return { name: 'soft', confidence: 0.64 };
  if (text || rmsDbfs > -50) return { name: 'casual', confidence: 0.6 };
  return { name: 'unknown', confidence: 0.2 };
}

function estimateWordCount(text: string): number {
  if (!text) return 0;
  try {
    const segmenter = new Intl.Segmenter(['th', 'en'], { granularity: 'word' });
    return [...segmenter.segment(text)].filter(segment => segment.isWordLike).length;
  } catch {
    const spaced = text.match(/[A-Za-z0-9]+|[\u0E00-\u0E7F]+/gu) ?? [];
    let count = 0;
    for (const token of spaced) {
      count += /^[\u0E00-\u0E7F]+$/u.test(token) ? Math.max(1, Math.round([...token].length / 4)) : 1;
    }
    return count;
  }
}

function amplitudeToDb(value: number): number {
  return value > 0 ? Math.max(-96, 20 * Math.log10(value)) : -96;
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const position = clamp(fraction, 0, 1) * (values.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return values[lower];
  return values[lower] + (values[upper] - values[lower]) * (position - lower);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}

function average(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nullableRound(value: number | null, digits: number): number | null {
  return value === null ? null : round(value, digits);
}

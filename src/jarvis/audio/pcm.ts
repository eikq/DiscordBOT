import { STT_PCM_CHANNELS, STT_PCM_SAMPLE_RATE } from './types';

export function durationMsOfPcm(pcm: Uint8Array, sampleRate: number, channels: number): number {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  return (sampleCount / Math.max(1, channels) / Math.max(1, sampleRate)) * 1_000;
}

export function rmsDbfs(pcm: Uint8Array, channels = 1): number {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  if (sampleCount < 1) return -120;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sumSquares = 0;
  for (let index = 0; index < sampleCount; index++) {
    const normalized = view.getInt16(index * 2, true) / 32_768;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

export function floatMonoToStereoS16(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 4);
  const view = new DataView(out.buffer);
  for (let index = 0; index < input.length; index++) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    const offset = index * 4;
    view.setInt16(offset, value, true);
    view.setInt16(offset + 2, value, true);
  }
  return out;
}

export function toSttStereoPcm(
  pcm: Uint8Array,
  sampleRate: number,
  channels: number,
): Uint8Array {
  const mono = toMonoS16(pcm, channels);
  const resampled = sampleRate === STT_PCM_SAMPLE_RATE
    ? mono
    : resampleMonoS16(mono, sampleRate, STT_PCM_SAMPLE_RATE);
  return upmixMonoToStereo(resampled);
}

export function makeSilencePcm(durationMs: number, sampleRate = STT_PCM_SAMPLE_RATE, channels = STT_PCM_CHANNELS): Uint8Array {
  const frames = Math.max(1, Math.round(sampleRate * durationMs / 1_000));
  return new Uint8Array(frames * channels * 2);
}

export function makeTonePcm(
  durationMs: number,
  options: { hz?: number; amplitude?: number; sampleRate?: number; channels?: number } = {},
): Uint8Array {
  const sampleRate = options.sampleRate ?? STT_PCM_SAMPLE_RATE;
  const channels = options.channels ?? STT_PCM_CHANNELS;
  const hz = options.hz ?? 440;
  const amplitude = options.amplitude ?? 0.35;
  const frames = Math.max(1, Math.round(sampleRate * durationMs / 1_000));
  const out = new Uint8Array(frames * channels * 2);
  const view = new DataView(out.buffer);
  for (let frame = 0; frame < frames; frame++) {
    const sample = Math.sin((2 * Math.PI * hz * frame) / sampleRate) * amplitude;
    const value = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    for (let channel = 0; channel < channels; channel++) {
      view.setInt16((frame * channels + channel) * 2, value, true);
    }
  }
  return out;
}

function toMonoS16(pcm: Uint8Array, channels: number): Uint8Array {
  if (channels <= 1) return pcm;
  const frames = Math.floor(pcm.byteLength / 2 / channels);
  const out = new Uint8Array(frames * 2);
  const source = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const dest = new DataView(out.buffer);
  for (let frame = 0; frame < frames; frame++) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel++) {
      sum += source.getInt16((frame * channels + channel) * 2, true);
    }
    dest.setInt16(frame * 2, Math.round(sum / channels), true);
  }
  return out;
}

function upmixMonoToStereo(mono: Uint8Array): Uint8Array {
  const frames = Math.floor(mono.byteLength / 2);
  const out = new Uint8Array(frames * 4);
  const source = new DataView(mono.buffer, mono.byteOffset, mono.byteLength);
  const dest = new DataView(out.buffer);
  for (let frame = 0; frame < frames; frame++) {
    const value = source.getInt16(frame * 2, true);
    dest.setInt16(frame * 4, value, true);
    dest.setInt16(frame * 4 + 2, value, true);
  }
  return out;
}

function resampleMonoS16(mono: Uint8Array, fromRate: number, toRate: number): Uint8Array {
  const sourceFrames = Math.floor(mono.byteLength / 2);
  const destFrames = Math.max(1, Math.round(sourceFrames * toRate / fromRate));
  const source = new DataView(mono.buffer, mono.byteOffset, mono.byteLength);
  const out = new Uint8Array(destFrames * 2);
  const dest = new DataView(out.buffer);
  for (let frame = 0; frame < destFrames; frame++) {
    const position = frame * fromRate / toRate;
    const left = Math.min(sourceFrames - 1, Math.floor(position));
    const right = Math.min(sourceFrames - 1, left + 1);
    const mix = position - left;
    const value = source.getInt16(left * 2, true) * (1 - mix) + source.getInt16(right * 2, true) * mix;
    dest.setInt16(frame * 2, value, true);
  }
  return out;
}

import { durationMsOfPcm, rmsDbfs } from './pcm';
import {
  STT_PCM_CHANNELS,
  STT_PCM_SAMPLE_RATE,
  type PcmFrame,
  type SpeechBusyPolicy,
  type SpeechCaptureState,
  type SpeechTurn,
  type SpeechTurnIgnoreReason,
  type SpeechTurnRejectReason,
} from './types';

export type SpeechTurnControllerOptions = {
  sampleRate?: number;
  channels?: number;
  minimumVoicedMs?: number;
  minimumRmsDbfs?: number;
  endSilenceMs?: number;
  maxCaptureMs?: number;
  minimumCaptureMs?: number;
  busyPolicy?: SpeechBusyPolicy;
  idFactory?: () => string;
};

export type SpeechTurnStartResult =
  | { ok: true; turnId: string }
  | { ok: false; reason: SpeechTurnRejectReason };

export type SpeechTurnPushResult =
  | { kind: 'listening' }
  | { kind: 'ignored'; reason: SpeechTurnIgnoreReason }
  | { kind: 'utterance'; turn: SpeechTurn }
  | { kind: 'rejected'; reason: SpeechTurnRejectReason };

/**
 * Segments local microphone PCM into utterances.
 * Overlapping turns are rejected while STT/Core is busy (JF-008 safe default).
 */
export class SpeechTurnController {
  private readonly sampleRate: number;
  private readonly channels: number;
  private readonly minimumVoicedMs: number;
  private readonly minimumRmsDbfs: number;
  private readonly endSilenceMs: number;
  private readonly maxCaptureMs: number;
  private readonly minimumCaptureMs: number;
  private readonly busyPolicy: SpeechBusyPolicy;
  private readonly idFactory: () => string;
  private state: SpeechCaptureState = 'idle';
  private pipelineBusy = false;
  private turnId = '';
  private chunks: Uint8Array[] = [];
  private captureMs = 0;
  private voicedMs = 0;
  private silenceMs = 0;
  private heardVoice = false;

  constructor(options: SpeechTurnControllerOptions = {}) {
    this.sampleRate = options.sampleRate ?? STT_PCM_SAMPLE_RATE;
    this.channels = options.channels ?? STT_PCM_CHANNELS;
    this.minimumVoicedMs = options.minimumVoicedMs ?? 480;
    this.minimumRmsDbfs = options.minimumRmsDbfs ?? -38;
    this.endSilenceMs = options.endSilenceMs ?? 750;
    this.maxCaptureMs = options.maxCaptureMs ?? 12_000;
    this.minimumCaptureMs = options.minimumCaptureMs ?? 0;
    this.busyPolicy = options.busyPolicy ?? 'reject';
    this.idFactory = options.idFactory ?? (() => `mic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  }

  public getCaptureState(): SpeechCaptureState {
    return this.state;
  }

  public isPipelineBusy(): boolean {
    return this.pipelineBusy;
  }

  public setPipelineBusy(busy: boolean): void {
    this.pipelineBusy = busy;
  }

  public startListening(): SpeechTurnStartResult {
    if (this.pipelineBusy) return { ok: false, reason: 'busy' };
    if (this.state === 'listening') return { ok: false, reason: 'busy' };
    this.resetCapture(this.idFactory());
    this.state = 'listening';
    return { ok: true, turnId: this.turnId };
  }

  public pushFrame(frame: PcmFrame): SpeechTurnPushResult {
    if (this.state !== 'listening') return { kind: 'rejected', reason: 'not-listening' };
    this.chunks.push(frame.pcm);
    const frameMs = durationMsOfPcm(frame.pcm, frame.sampleRate, frame.channels);
    this.captureMs += frameMs;
    const level = rmsDbfs(frame.pcm, frame.channels);
    if (level >= this.minimumRmsDbfs) {
      this.voicedMs += frameMs;
      this.silenceMs = 0;
      if (this.voicedMs >= this.minimumVoicedMs) this.heardVoice = true;
    } else if (this.heardVoice) {
      this.silenceMs += frameMs;
    }

    if (this.heardVoice && this.silenceMs >= this.endSilenceMs) {
      return this.finalize('silence');
    }
    if (this.captureMs >= this.maxCaptureMs) {
      return this.finalize('max-duration');
    }
    return { kind: 'listening' };
  }

  public stopListening(): SpeechTurnPushResult {
    if (this.state !== 'listening') return { kind: 'rejected', reason: 'not-listening' };
    return this.finalize('stop');
  }

  private finalize(reason: SpeechTurn['reason']): SpeechTurnPushResult {
    this.state = 'finalizing';
    const pcm = concat(this.chunks);
    const turn: SpeechTurn = {
      turnId: this.turnId,
      pcm,
      sampleRate: this.sampleRate,
      channels: this.channels,
      captureDurationMs: this.captureMs,
      voicedMs: this.voicedMs,
      ...(reason === 'silence' ? { utteranceFinalizeMs: this.silenceMs } : {}),
      reason,
    };
    const heardVoice = this.heardVoice;
    const voicedMs = this.voicedMs;
    const captureMs = this.captureMs;
    this.resetCapture('');
    this.state = 'idle';
    if (!heardVoice || voicedMs < this.minimumVoicedMs || pcm.byteLength === 0) {
      return {
        kind: 'ignored',
        reason: pcm.byteLength === 0 ? 'empty' : heardVoice ? 'too-short' : 'noise-only',
      };
    }
    if (this.minimumCaptureMs > 0 && captureMs < this.minimumCaptureMs) {
      return { kind: 'ignored', reason: 'too-short' };
    }
    return { kind: 'utterance', turn };
  }

  private resetCapture(turnId: string): void {
    this.turnId = turnId;
    this.chunks = [];
    this.captureMs = 0;
    this.voicedMs = 0;
    this.silenceMs = 0;
    this.heardVoice = false;
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function describeBusyPolicy(policy: SpeechBusyPolicy = 'reject'): string {
  return policy === 'reject'
    ? 'New microphone speech is rejected while a turn is transcribing or Jarvis is answering.'
    : policy;
}

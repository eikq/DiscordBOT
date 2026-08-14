export interface SustainedVoiceDetectorOptions {
  minimumVoicedMs?: number;
  minimumRmsDbfs?: number;
  sampleRate?: number;
  channels?: number;
}

export interface VoiceActivityObservation {
  confirmed: boolean;
  rmsDbfs: number;
  voicedMs: number;
}

export class SustainedVoiceDetector {
  private readonly minimumVoicedMs: number;
  private readonly minimumRmsDbfs: number;
  private readonly sampleRate: number;
  private readonly channels: number;
  private voicedMs = 0;
  private confirmed = false;

  constructor(options: SustainedVoiceDetectorOptions = {}) {
    this.minimumVoicedMs = options.minimumVoicedMs ?? 320;
    this.minimumRmsDbfs = options.minimumRmsDbfs ?? -42;
    this.sampleRate = options.sampleRate ?? 48_000;
    this.channels = options.channels ?? 2;
  }

  public observePcm(chunk: Buffer): VoiceActivityObservation {
    if (this.confirmed || chunk.length < 2) {
      return { confirmed: this.confirmed, rmsDbfs: -120, voicedMs: this.voicedMs };
    }

    const sampleCount = Math.floor(chunk.length / 2);
    let sumSquares = 0;
    for (let index = 0; index < sampleCount; index++) {
      const normalized = chunk.readInt16LE(index * 2) / 32_768;
      sumSquares += normalized * normalized;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
    const rmsDbfs = 20 * Math.log10(Math.max(rms, 1e-6));
    const durationMs = (sampleCount / Math.max(1, this.channels) / this.sampleRate) * 1_000;

    if (rmsDbfs >= this.minimumRmsDbfs) {
      this.voicedMs += durationMs;
    } else {
      // Do not let isolated Discord VAD/noise packets accumulate into an interruption.
      this.voicedMs = Math.max(0, this.voicedMs - durationMs * 2);
    }
    this.confirmed = this.voicedMs >= this.minimumVoicedMs;
    return { confirmed: this.confirmed, rmsDbfs, voicedMs: this.voicedMs };
  }
}

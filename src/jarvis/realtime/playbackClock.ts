import { cancelPlayback, playbackAtElapsed } from '../presentation/briefing/playback';
import type { PresentationModel } from '../presentation/briefing/types';
import type { PlaybackClockSource } from './types';

/**
 * One authoritative playback timeline. Speech elapsed wins while speaking.
 * Estimated duration is bootstrap only and is ignored during speech.
 */
export class PlaybackClock {
  private source: PlaybackClockSource = 'bootstrap_estimate';
  private speechActive = false;
  private speechElapsedMs = 0;
  private estimateElapsedMs = 0;
  private seekElapsedMs = 0;

  public snapshot(): { source: PlaybackClockSource; elapsedMs: number; speechActive: boolean } {
    return { source: this.source, elapsedMs: this.elapsedMs(), speechActive: this.speechActive };
  }

  public elapsedMs(): number {
    if (this.speechActive || this.source === 'speech') return this.speechElapsedMs;
    if (this.source === 'seek') return this.seekElapsedMs;
    return this.estimateElapsedMs;
  }

  public startSpeech(): void {
    this.speechActive = true;
    this.source = 'speech';
    this.speechElapsedMs = 0;
  }

  public setSpeechElapsed(ms: number): void {
    if (!this.speechActive) return;
    this.source = 'speech';
    this.speechElapsedMs = Math.max(0, ms);
  }

  public stopSpeech(completed = false): void {
    this.speechActive = false;
    if (completed) this.source = 'speech';
  }

  public cancel(): void {
    this.speechActive = false;
    this.source = 'speech';
  }

  public seek(ms: number): void {
    this.speechActive = false;
    this.source = 'seek';
    this.seekElapsedMs = Math.max(0, ms);
  }

  /** Silent Presenter preview only. Ignored while speech is the authority. */
  public bootstrapEstimate(ms: number): void {
    if (this.speechActive || this.source === 'speech') return;
    this.source = 'bootstrap_estimate';
    this.estimateElapsedMs = Math.max(0, ms);
  }
}

export function syncPresenterPlayback(model: PresentationModel, clock: PlaybackClock): PresentationModel {
  const elapsed = clock.elapsedMs();
  const snap = clock.snapshot();
  if (!snap.speechActive && model.playback.playbackState === 'cancelled') {
    return cancelPlayback(model);
  }
  const playback = playbackAtElapsed(model.id, model.narrationSegments, elapsed, {
    actualSpeechDurationMs: model.playback.actualSpeechDurationMs,
    playbackState: snap.speechActive ? 'playing' : model.playback.playbackState,
  });
  return { ...model, playback };
}

export function shouldRunEstimateTimer(speechActive: boolean): boolean {
  return speechActive !== true;
}

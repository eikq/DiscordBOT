import type { MotionCueAction, NarrationPlaybackState, NarrationSegment, PresentationModel } from './types';
import { scaleNarrationToSpeech } from './narration';
import { buildMotionTimeline } from './motion';

export function spokenSequenceFrom(
  model: Pick<PresentationModel, 'narrationSegments' | 'spokenSummary'>,
): string {
  const parts = model.narrationSegments.map(item => item.text.trim()).filter(Boolean);
  if (parts.length > 0) return parts.join(' ');
  return model.spokenSummary;
}

export function segmentStartMs(segments: NarrationSegment[], index: number): number {
  let cursor = 0;
  const last = Math.max(0, Math.min(index, Math.max(0, segments.length - 1)));
  for (let i = 0; i < last; i += 1) cursor += segments[i]?.estimatedMs ?? 0;
  return cursor;
}

export function createPlayback(
  presentationId: string,
  segments: NarrationSegment[],
  extra: Partial<NarrationPlaybackState> = {},
): NarrationPlaybackState {
  const first = segments[0];
  return {
    presentationId,
    segmentId: first?.id || 'narr-summary',
    segmentIndex: 0,
    spokenAtMs: 0,
    estimatedDurationMs: segments.reduce((sum, item) => sum + item.estimatedMs, 0),
    playbackState: extra.playbackState ?? 'idle',
    targetId: first?.target.id || 'sec-summary',
    motionCue: 'focus',
    ...extra,
    pauseSupported: false,
  };
}

export function playbackAtElapsed(
  presentationId: string,
  segments: NarrationSegment[],
  elapsedMs: number,
  extra: Partial<NarrationPlaybackState> = {},
): NarrationPlaybackState {
  if (segments.length === 0) {
    return createPlayback(presentationId, segments, { ...extra, spokenAtMs: elapsedMs, playbackState: extra.playbackState ?? 'idle' });
  }
  let cursor = 0;
  let index = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const end = cursor + segments[i].estimatedMs;
    if (elapsedMs < end || i === segments.length - 1) {
      index = i;
      break;
    }
    cursor = end;
  }
  const segment = segments[index];
  const total = segments.reduce((sum, item) => sum + item.estimatedMs, 0);
  const completed = elapsedMs >= total && extra.playbackState !== 'cancelled';
  return {
    presentationId,
    segmentId: segment.id,
    segmentIndex: index,
    spokenAtMs: Math.max(0, elapsedMs),
    estimatedDurationMs: total,
    playbackState: extra.playbackState ?? (completed ? 'completed' : 'playing'),
    targetId: segment.target.id,
    motionCue: motionCueFor(segment),
    pauseSupported: false,
    ...(extra.actualSpeechDurationMs !== undefined ? { actualSpeechDurationMs: extra.actualSpeechDurationMs } : {}),
  };
}

export function repeatPlayback(model: PresentationModel): PresentationModel {
  const index = Math.max(0, model.playback?.segmentIndex ?? 0);
  return seekPlayback(model, index, 'playing');
}

export function backPlayback(model: PresentationModel): PresentationModel {
  const current = model.playback?.segmentIndex ?? 0;
  return seekPlayback(model, Math.max(0, current - 1), 'playing');
}

export function cancelPlayback(model: PresentationModel): PresentationModel {
  if (!model.playback) return model;
  return {
    ...model,
    playback: {
      ...model.playback,
      playbackState: 'cancelled',
    },
  };
}

export function markPauseUnsupported(model: PresentationModel): PresentationModel {
  if (!model.playback) return model;
  return {
    ...model,
    playback: {
      ...model.playback,
      playbackState: 'pause_unsupported',
      pauseSupported: false,
    },
  };
}

export function applySpokenDuration(
  model: PresentationModel,
  spokenMs: number,
  reducedMotion = false,
): PresentationModel {
  const segments = scaleNarrationToSpeech(model.narrationSegments, spokenMs);
  const elapsed = model.playback?.spokenAtMs ?? 0;
  return {
    ...model,
    narrationSegments: segments,
    motionTimeline: buildMotionTimeline(segments, { reducedMotion }),
    playback: playbackAtElapsed(model.id, segments, elapsed, {
      actualSpeechDurationMs: spokenMs,
      playbackState: model.playback?.playbackState ?? 'playing',
    }),
  };
}

export function seekPlayback(
  model: PresentationModel,
  segmentIndex: number,
  playbackState: NarrationPlaybackState['playbackState'] = 'playing',
): PresentationModel {
  const max = Math.max(0, model.narrationSegments.length - 1);
  const index = Math.max(0, Math.min(segmentIndex, max));
  const segment = model.narrationSegments[index];
  if (!segment) return model;
  const spokenAtMs = segmentStartMs(model.narrationSegments, index);
  const cue = {
    id: `cue-seek-${segment.id}`,
    segmentId: segment.id,
    atMs: spokenAtMs,
    action: 'focus' as const,
    target: segment.target,
    reducedMotion: 'instant' as const,
  };
  return {
    ...model,
    playback: {
      presentationId: model.id,
      segmentId: segment.id,
      segmentIndex: index,
      spokenAtMs,
      estimatedDurationMs: model.narrationSegments.reduce((sum, item) => sum + item.estimatedMs, 0),
      actualSpeechDurationMs: model.playback?.actualSpeechDurationMs,
      playbackState,
      targetId: segment.target.id,
      motionCue: motionCueFor(segment),
      pauseSupported: false,
    },
    motionTimeline: [
      ...model.motionTimeline.filter(item => item.id !== cue.id),
      cue,
    ],
  };
}

function motionCueFor(segment: NarrationSegment): MotionCueAction {
  if (segment.target.id === 'system.gpu' || segment.target.id.startsWith('system.')) return 'highlight';
  if (segment.kind === 'section') return 'focus';
  return 'focus';
}

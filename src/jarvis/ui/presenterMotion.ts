import { playbackAtElapsed } from '../presentation/briefing/playback';
import type { MotionCue, PlannedPresentation } from '../presentation/briefing/types';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function visibleMotionCues(
  planned: PlannedPresentation | undefined,
  atMs: number,
  reducedMotion = prefersReducedMotion(),
): MotionCue[] {
  if (!planned || planned.density === 'plain') return [];
  return planned.motionTimeline.filter(cue => {
    if (atMs < cue.atMs) return false;
    if (reducedMotion && (cue.action === 'pulse' || cue.action === 'zoom')) return false;
    if (reducedMotion && cue.reducedMotion === 'skip') return false;
    return true;
  });
}

export function focusedTargetId(cues: MotionCue[]): string | null {
  const last = cues.at(-1);
  return last?.target.id ?? null;
}

export function playbackTargetId(planned: PlannedPresentation | undefined, atMs: number): string | null {
  if (!planned || planned.density === 'plain') return null;
  const playback = playbackAtElapsed(planned.id, planned.narrationSegments, atMs, {
    actualSpeechDurationMs: planned.playback?.actualSpeechDurationMs,
    playbackState: planned.playback?.playbackState,
  });
  return playback.targetId;
}

import type { MotionCue, PlannedPresentation } from '../presentation/briefing/types';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function visibleMotionCues(planned: PlannedPresentation | undefined, atMs: number): MotionCue[] {
  if (!planned || planned.density === 'plain') return [];
  const reduced = prefersReducedMotion();
  return planned.motionTimeline.filter(cue => {
    if (atMs < cue.atMs) return false;
    if (reduced && (cue.action === 'pulse' || cue.action === 'zoom')) return false;
    return true;
  });
}

export function focusedTargetId(cues: MotionCue[]): string | null {
  const last = cues.at(-1);
  return last?.target.id ?? null;
}

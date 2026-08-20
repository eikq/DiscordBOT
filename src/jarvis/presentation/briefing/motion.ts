import type { MotionCue, NarrationSegment, PresentationModel } from './types';

export type MotionOptions = {
  reducedMotion?: boolean;
};

const SKIP_WHEN_REDUCED = new Set(['zoom', 'pulse']);

export function buildMotionTimeline(
  segments: NarrationSegment[],
  options: MotionOptions = {},
): MotionCue[] {
  const reduced = Boolean(options.reducedMotion);
  let cursor = 0;
  const cues: MotionCue[] = [];
  for (const segment of segments) {
    const focus = cueFor(segment, cursor, 'focus', reduced);
    if (focus) cues.push(focus);
    const metric = segment.target.id.startsWith('system.') || segment.target.id === 'desktop.displays';
    if (metric || segment.kind === 'section') {
      const highlight = cueFor(segment, cursor + Math.min(120, Math.round(segment.estimatedMs * 0.08)), 'highlight', reduced);
      if (highlight) cues.push(highlight);
    }
    if (segment.target.type === 'source') {
      const spot = cueFor(segment, cursor + 80, 'spotlight', reduced);
      if (spot) cues.push(spot);
    }
    if (segment.target.type === 'graph-node') {
      const pulse = cueFor(segment, cursor + 80, 'pulse', reduced);
      if (pulse) cues.push(pulse);
    }
    cursor += segment.estimatedMs;
  }
  return cues;
}

export function activeMotionCues(timeline: MotionCue[], atMs: number, reducedMotion = false): MotionCue[] {
  return timeline.filter(cue => {
    if (reducedMotion && cue.reducedMotion === 'skip') return false;
    return atMs >= cue.atMs;
  });
}

export function motionTargetsOf(model: PresentationModel): Set<string> {
  return new Set([
    ...model.sections.map(item => item.id),
    ...model.cards.map(item => item.id),
    ...model.evidence.map(item => item.id),
    ...model.recommendedActions.map((_, index) => `rec-${index}`),
  ]);
}

function cueFor(
  segment: NarrationSegment,
  atMs: number,
  action: MotionCue['action'],
  reduced: boolean,
): MotionCue | null {
  if (reduced && SKIP_WHEN_REDUCED.has(action)) return null;
  return {
    id: `cue-${segment.id}-${action}`,
    segmentId: segment.id,
    atMs: Math.max(0, atMs),
    action,
    target: segment.target,
    reducedMotion: reduced ? 'instant' : (SKIP_WHEN_REDUCED.has(action) ? 'skip' : 'instant'),
  };
}

import type { PresentationFollowUp, PresentationFollowUpId, PresentationModel } from './types';

export function defaultFollowUps(model: Pick<PresentationModel, 'mode' | 'evidence' | 'recommendedActions' | 'sections'>): PresentationFollowUp[] {
  const items: PresentationFollowUp[] = [
    { id: 'explain', label: 'Explain this' },
    { id: 'expand', label: 'Expand this section' },
    { id: 'shorten', label: 'Summarize shorter' },
    { id: 'repeat', label: 'Repeat that' },
    { id: 'back', label: 'Go back' },
  ];
  if (model.mode === 'comparison' || model.sections.some(item => item.kind === 'comparison')) {
    items.splice(2, 0, { id: 'compare', label: 'Compare those two' });
  }
  if (model.evidence[0]) {
    items.push({ id: 'show-source', label: 'Show source', targetId: model.evidence[0].id });
  }
  if (model.recommendedActions[0]) {
    items.push({ id: 'focus-recommendations', label: 'Focus on recommendations' });
  }
  return items;
}

export function applyBriefingFollowUp(
  model: PresentationModel,
  action: PresentationFollowUpId,
  targetId?: string,
): PresentationModel {
  if (action === 'shorten') {
    return {
      ...model,
      density: 'rich',
      subtitle: model.subtitle || 'Shorter summary',
      sections: model.sections.filter(section => section.kind === 'summary' || section.kind === 'actions'),
      narrationSegments: model.narrationSegments.filter(item => item.kind === 'summary'),
      motionTimeline: model.motionTimeline.filter(item => item.segmentId === 'narr-summary'),
    };
  }
  if (action === 'expand' || action === 'explain') {
    const focusId = targetId || model.sections.find(item => item.kind === 'findings')?.id || model.sections[0]?.id;
    return {
      ...model,
      subtitle: action === 'explain' ? 'Explained' : 'Expanded',
      motionTimeline: [
        ...model.motionTimeline,
        {
          id: `cue-followup-${action}`,
          segmentId: 'narr-summary',
          atMs: 0,
          action: 'expand',
          target: { type: 'section', id: focusId || 'sec-summary' },
          reducedMotion: 'instant',
        },
      ],
    };
  }
  if (action === 'show-source') {
    const sourceId = targetId || model.evidence[0]?.id;
    if (!sourceId) return model;
    return {
      ...model,
      motionTimeline: [
        ...model.motionTimeline,
        {
          id: 'cue-followup-source',
          segmentId: 'narr-summary',
          atMs: 0,
          action: 'spotlight',
          target: { type: 'source', id: sourceId },
          reducedMotion: 'instant',
        },
      ],
    };
  }
  if (action === 'focus-recommendations') {
    return {
      ...model,
      motionTimeline: [
        ...model.motionTimeline,
        {
          id: 'cue-followup-recs',
          segmentId: 'narr-actions',
          atMs: 0,
          action: 'focus',
          target: { type: 'recommendation', id: 'rec-0' },
          reducedMotion: 'instant',
        },
      ],
    };
  }
  if (action === 'compare') {
    const comparison = model.sections.find(item => item.kind === 'comparison') || model.sections[0];
    return {
      ...model,
      motionTimeline: [
        ...model.motionTimeline,
        {
          id: 'cue-followup-compare',
          segmentId: 'narr-summary',
          atMs: 0,
          action: 'highlight',
          target: { type: 'section', id: comparison?.id || 'sec-summary' },
          reducedMotion: 'instant',
        },
      ],
    };
  }
  return model;
}

export function isPresentationFollowUp(value: string): value is PresentationFollowUpId {
  return value === 'explain'
    || value === 'expand'
    || value === 'compare'
    || value === 'shorten'
    || value === 'repeat'
    || value === 'back'
    || value === 'show-source'
    || value === 'focus-recommendations';
}

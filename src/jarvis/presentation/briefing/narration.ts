import type { NarrationSegment, PresentationModel, PresentationSection } from './types';

const WORDS_PER_MS = 2.5 / 1000;

export function estimateNarrationMs(text: string): number {
  const words = text.trim().split(/\s+/u).filter(Boolean).length;
  return Math.max(800, Math.round(words / WORDS_PER_MS));
}

export function spokenSummaryFrom(summary: string, mode: PresentationModel['mode']): string {
  const clipped = clipSentence(summary, 220);
  if (mode === 'comparison') return `Here is the comparison. ${clipped}`;
  if (mode === 'walkthrough') return `Here is the walkthrough. ${clipped}`;
  if (mode === 'recommendation') return `Here is the recommendation. ${clipped}`;
  if (mode === 'report') return `Here is the report. ${clipped}`;
  return clipped;
}

export function buildNarrationSegments(model: Pick<PresentationModel, 'mode' | 'summary' | 'sections' | 'recommendedActions' | 'density'>): NarrationSegment[] {
  const spoken = spokenSummaryFrom(model.summary, model.mode);
  const segments: NarrationSegment[] = [{
    id: 'narr-summary',
    order: 0,
    text: spoken,
    kind: 'summary',
    target: { type: 'section', id: 'sec-summary' },
    estimatedMs: estimateNarrationMs(spoken),
  }];

  const narratable = model.sections.filter(section => section.id !== 'sec-summary' && section.body);
  for (const [index, section] of narratable.entries()) {
    const text = sectionNarration(section);
    segments.push({
      id: `narr-${section.id}`,
      order: index + 1,
      text,
      kind: 'section',
      target: { type: 'section', id: section.id },
      estimatedMs: estimateNarrationMs(text),
    });
  }

  if (model.density === 'briefing' && model.recommendedActions[0]) {
    const text = `Recommended next: ${clipSentence(model.recommendedActions[0], 160)}`;
    segments.push({
      id: 'narr-actions',
      order: segments.length,
      text,
      kind: 'extended',
      target: { type: 'recommendation', id: 'rec-0' },
      estimatedMs: estimateNarrationMs(text),
    });
  }

  return segments;
}

export function scaleNarrationToSpeech(
  segments: NarrationSegment[],
  spokenMs?: number,
): NarrationSegment[] {
  if (!spokenMs || spokenMs < 200 || segments.length === 0) return segments;
  const estimated = segments.reduce((sum, item) => sum + item.estimatedMs, 0);
  if (estimated <= 0) return segments;
  const factor = spokenMs / estimated;
  return segments.map(item => ({
    ...item,
    estimatedMs: Math.max(400, Math.round(item.estimatedMs * factor)),
  }));
}

function sectionNarration(section: PresentationSection): string {
  return clipSentence(`${section.title}. ${section.body}`, 240);
}

function clipSentence(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${(lastStop > 40 ? cut.slice(0, lastStop) : cut).trim()}…`;
}

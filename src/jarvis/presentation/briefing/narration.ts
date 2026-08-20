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

export function buildNarrationSegments(model: Pick<PresentationModel, 'mode' | 'summary' | 'sections' | 'recommendedActions' | 'density' | 'evidence' | 'cards'>): NarrationSegment[] {
  const spoken = spokenSummaryFrom(model.summary, model.mode);
  const segments: NarrationSegment[] = [{
    id: 'narr-summary',
    order: 0,
    text: spoken,
    kind: 'summary',
    target: { type: 'section', id: 'sec-summary' },
    estimatedMs: estimateNarrationMs(spoken),
  }];

  const narratable = model.sections.filter(section => (
    section.id !== 'sec-summary'
    && section.kind !== 'followups'
    && section.body
  )).slice(0, 4);
  for (const [index, section] of narratable.entries()) {
    const text = sectionNarration(section);
    const sourceId = sourceIdForSection(section, model);
    segments.push({
      id: `narr-${section.id}`,
      order: index + 1,
      text,
      kind: 'section',
      target: sourceId
        ? { type: 'source', id: sourceId }
        : section.cards?.[0]
        ? { type: section.cards[0].startsWith('system.') ? 'metric' : 'card', id: section.cards[0] }
        : { type: 'section', id: section.id },
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

  const finish = 'That is the briefing. Ask if you want a section repeated.';
  segments.push({
    id: 'narr-finish',
    order: segments.length,
    text: finish,
    kind: 'finish',
    target: { type: 'section', id: 'sec-followups' },
    estimatedMs: estimateNarrationMs(finish),
  });

  return segments;
}

export function scaleNarrationToSpeech(
  segments: NarrationSegment[],
  spokenMs?: number,
): NarrationSegment[] {
  if (!spokenMs || spokenMs < 200 || segments.length === 0) return segments;
  const estimated = segments.reduce((sum, item) => sum + item.estimatedMs, 0);
  if (estimated <= 0) return segments;
  const rounded = segments.map(item => Math.max(1, Math.round((item.estimatedMs / estimated) * spokenMs)));
  rounded[rounded.length - 1] += spokenMs - rounded.reduce((sum, item) => sum + item, 0);
  if (rounded[rounded.length - 1] < 1) {
    let need = 1 - rounded[rounded.length - 1];
    rounded[rounded.length - 1] = 1;
    for (let i = 0; i < rounded.length - 1 && need > 0; i += 1) {
      const take = Math.min(Math.max(0, rounded[i] - 1), need);
      rounded[i] -= take;
      need -= take;
    }
  }
  return segments.map((item, index) => ({
    ...item,
    estimatedMs: rounded[index] ?? item.estimatedMs,
  }));
}

function sourceIdForSection(
  section: PresentationSection,
  model: Pick<PresentationModel, 'evidence' | 'cards'>,
): string | undefined {
  if (section.id === 'sec-conflicts') {
    return model.evidence?.[1]?.id || model.evidence?.[0]?.id;
  }
  if (section.id === 'sec-quality' || section.id === 'sec-timeline' || section.id === 'sec-evidence') {
    const match = model.evidence?.find(item =>
      section.body.includes(item.label) || section.body.includes(item.id),
    );
    return match?.id || model.evidence?.[0]?.id;
  }
  const card = model.cards?.find(item => section.cards?.includes(item.id));
  return card?.refs?.[0];
}

function sectionNarration(section: PresentationSection): string {
  return clipSentence(`${section.title}. ${section.body}`, 120);
}

function clipSentence(text: string, max: number): string {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
  return `${(lastStop > 40 ? cut.slice(0, lastStop) : cut).trim()}…`;
}

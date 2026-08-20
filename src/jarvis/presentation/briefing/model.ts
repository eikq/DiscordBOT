import { createHash } from 'node:crypto';
import { defaultFollowUps } from './followUp';
import { buildMotionTimeline, type MotionOptions } from './motion';
import { buildNarrationSegments, spokenSummaryFrom } from './narration';
import type { PresentationPlan } from './planner';
import type {
  PresentationCard,
  PresentationEvidenceRef,
  PresentationInput,
  PresentationModel,
  PresentationSection,
  PresentationTable,
} from './types';

export function buildPresentationModel(
  input: PresentationInput,
  plan: PresentationPlan,
  options: MotionOptions = {},
): PresentationModel {
  const reply = String(input.replyText || input.workOutcome?.text || input.research?.synthesis || '').trim();
  const title = titleFor(input, plan);
  const summary = summaryFor(input, reply);
  const evidence = evidenceFor(input);
  const cards = cardsFor(input, evidence, plan);
  const sections = sectionsFor(input, summary, cards, evidence, plan);
  const tables = tablesFor(input, plan);
  const limitations = limitationsFor(input);
  const recommendedActions = actionsFor(input, plan);
  const spokenSummary = spokenSummaryFrom(summary, plan.mode);
  const draft: PresentationModel = {
    id: `pres_${createHash('sha1').update(`${title}|${summary}|${plan.mode}`).digest('hex').slice(0, 12)}`,
    title,
    subtitle: subtitleFor(input, plan),
    mode: plan.mode,
    density: plan.density === 'plain' ? 'rich' : plan.density,
    summary,
    spokenSummary,
    sections,
    cards,
    evidence,
    ...(tables ? { tables } : {}),
    confidence: confidenceFor(input),
    limitations,
    recommendedActions,
    followUpSuggestions: [],
    narrationSegments: [],
    motionTimeline: [],
  };
  draft.followUpSuggestions = defaultFollowUps(draft);
  draft.narrationSegments = buildNarrationSegments(draft);
  draft.motionTimeline = buildMotionTimeline(draft.narrationSegments, options);
  return draft;
}

function titleFor(input: PresentationInput, plan: PresentationPlan): string {
  if (input.research?.query) return clip(input.research.query, 72);
  if (input.capabilityId === 'system.status') return 'System status';
  if (input.displays) return 'Desktop presence';
  if (plan.mode === 'comparison') return 'Comparison';
  if (plan.mode === 'walkthrough') return 'Walkthrough';
  if (plan.mode === 'recommendation') return 'Recommendation';
  const text = input.text.trim();
  return clip(text || 'Briefing', 72);
}

function subtitleFor(input: PresentationInput, plan: PresentationPlan): string | undefined {
  if (input.workOutcome?.outcome) return input.workOutcome.outcome;
  if (input.research?.sources?.length) return `${input.research.sources.length} sources`;
  if (plan.reason) return plan.reason.replace(/_/g, ' ');
  return undefined;
}

function summaryFor(input: PresentationInput, reply: string): string {
  if (input.research?.synthesis) return clip(input.research.synthesis, 360);
  if (input.workOutcome?.verification) {
    return clip([input.workOutcome.text, input.workOutcome.verification].filter(Boolean).join(' '), 360);
  }
  if (input.systemSnapshot?.summary) return clip(input.systemSnapshot.summary, 360);
  if (input.displays) {
    const count = input.displays.count ?? 0;
    const current = input.displays.currentName || 'unknown display';
    return clip(`Jarvis is on ${current}. ${count} display${count === 1 ? '' : 's'} visible. ${input.displays.reason || ''}`.trim(), 360);
  }
  if (reply) return clip(reply, 360);
  return clip(input.text, 360);
}

function evidenceFor(input: PresentationInput): PresentationEvidenceRef[] {
  const fromResearch = (input.research?.sources ?? []).slice(0, 8).map(source => ({
    id: source.sourceId,
    label: source.title || source.domain || source.url,
    url: source.url,
  }));
  if (fromResearch.length > 0) return fromResearch;
  return (input.workOutcome?.evidence ?? []).slice(0, 6).map((item, index) => ({
    id: `ev-${index}`,
    label: clip(item, 120),
  }));
}

function cardsFor(
  input: PresentationInput,
  evidence: PresentationEvidenceRef[],
  plan: PresentationPlan,
): PresentationCard[] {
  const cards: PresentationCard[] = [];
  const findings = (input.research?.evidence ?? []).slice(0, 6);
  for (const item of findings) {
    cards.push({
      id: item.evidenceId,
      title: 'Finding',
      body: clip(item.claim, 220),
      kind: 'finding',
      refs: [item.sourceId],
    });
  }
  for (const item of (input.workOutcome?.observations ?? []).slice(0, 4)) {
    cards.push({
      id: `obs-${cards.length}`,
      title: 'Observation',
      body: clip(item, 220),
      kind: 'note',
    });
  }
  for (const item of (input.systemSnapshot?.parts ?? []).slice(0, 6)) {
    cards.push({
      id: `sys-${cards.length}`,
      title: 'Telemetry',
      body: clip(item, 160),
      kind: 'note',
    });
  }
  if (cards.length === 0 && evidence[0]) {
    cards.push({
      id: 'card-evidence',
      title: plan.mode === 'comparison' ? 'Compared sources' : 'Evidence',
      body: clip(evidence.map(item => item.label).join(' · '), 220),
      kind: 'evidence',
      refs: evidence.map(item => item.id),
    });
  }
  return cards;
}

function sectionsFor(
  input: PresentationInput,
  summary: string,
  cards: PresentationCard[],
  evidence: PresentationEvidenceRef[],
  plan: PresentationPlan,
): PresentationSection[] {
  const findingCards = cards.filter(item => item.kind === 'finding' || item.kind === 'note').map(item => item.id);
  const sections: PresentationSection[] = [
    { id: 'sec-summary', title: 'Executive summary', kind: 'summary', body: summary },
  ];
  if (findingCards.length > 0) {
    sections.push({
      id: 'sec-findings',
      title: 'Key findings',
      kind: 'findings',
      body: cards.filter(item => findingCards.includes(item.id)).map(item => item.body).slice(0, 3).join(' '),
      cards: findingCards,
    });
  }
  if (plan.mode === 'comparison' && evidence.length >= 2) {
    sections.push({
      id: 'sec-compare',
      title: 'Comparison',
      kind: 'comparison',
      body: evidence.slice(0, 4).map(item => item.label).join(' vs '),
    });
  }
  if (evidence.length > 0) {
    sections.push({
      id: 'sec-evidence',
      title: 'Evidence / sources',
      kind: 'evidence',
      body: evidence.map(item => item.label).join(' · '),
    });
  }
  const risks = limitationsFor(input);
  if (risks.length > 0) {
    sections.push({
      id: 'sec-risks',
      title: 'Risks / limitations',
      kind: 'risks',
      body: risks.join(' '),
    });
  }
  const actions = actionsFor(input, plan);
  if (actions.length > 0) {
    sections.push({
      id: 'sec-actions',
      title: 'Recommended actions',
      kind: 'actions',
      body: actions.join(' '),
    });
  }
  sections.push({
    id: 'sec-followups',
    title: 'Follow-up',
    kind: 'followups',
    body: 'Ask to explain, expand, compare, shorten, show a source, or focus on recommendations.',
  });
  return sections;
}

function tablesFor(input: PresentationInput, plan: PresentationPlan): PresentationTable[] | undefined {
  if (plan.mode !== 'comparison' || !input.research?.sources || input.research.sources.length < 2) {
    return undefined;
  }
  return [{
    id: 'tbl-sources',
    title: 'Sources',
    headers: ['Source', 'URL'],
    rows: input.research.sources.slice(0, 6).map(item => [item.title || item.domain || item.sourceId, item.url]),
  }];
}

function limitationsFor(input: PresentationInput): string[] {
  const items = [...(input.research?.uncertainty ?? [])];
  if (input.workOutcome?.outcome === 'PARTIAL' || input.workOutcome?.outcome === 'DEGRADED') {
    items.push('This result is partial or degraded. Do not treat it as complete.');
  }
  if (input.research?.sources?.length) {
    items.push('Web sources are untrusted external data. Citations are not invented.');
  }
  if (input.displays?.reason) items.push(input.displays.reason);
  return unique(items).slice(0, 6);
}

function actionsFor(input: PresentationInput, plan: PresentationPlan): string[] {
  if (plan.mode === 'recommendation' || plan.mode === 'walkthrough') {
    return unique([
      ...(input.workOutcome?.observations ?? []).slice(0, 2),
      'Review the evidence before acting.',
    ]).slice(0, 4);
  }
  if (input.capabilityId?.startsWith('desktop.') && input.displays?.reason) {
    return ['Use Presenter Mode in the lab if the browser host cannot move the window.'];
  }
  if (input.research?.sources?.[0]) {
    return ['Open a cited source only after you choose it.', 'Ask to compare two sources if needed.'];
  }
  return [];
}

function confidenceFor(input: PresentationInput): PresentationModel['confidence'] | undefined {
  if (input.research?.uncertainty?.length) {
    return { level: 'medium', note: 'Some claims remain uncertain.' };
  }
  if (input.workOutcome?.outcome === 'SUCCESS' && (input.workOutcome.evidence?.length ?? 0) > 0) {
    return { level: 'high', note: 'Supported by recorded evidence.' };
  }
  if (input.workOutcome?.outcome === 'FAILED' || input.workOutcome?.outcome === 'BLOCKED') {
    return { level: 'low', note: input.workOutcome.outcome };
  }
  return undefined;
}

function clip(value: string, max: number): string {
  const clean = value.replace(/\s+/gu, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trim()}…`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))];
}

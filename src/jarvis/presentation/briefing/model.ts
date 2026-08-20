import { createHash } from 'node:crypto';
import { defaultFollowUps } from './followUp';
import { buildMotionTimeline, type MotionOptions } from './motion';
import { buildNarrationSegments, spokenSummaryFrom } from './narration';
import { createPlayback } from './playback';
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
  const includeResearch = shouldAttachResearch(input, plan);
  const title = titleFor(input, plan);
  const summary = summaryFor(input, reply, includeResearch);
  const evidence = evidenceFor(input, includeResearch);
  const cards = cardsFor(input, evidence, plan, includeResearch);
  const sections = sectionsFor(input, summary, cards, evidence, plan);
  const tables = includeResearch ? tablesFor(input, plan) : undefined;
  const limitations = limitationsFor(input, includeResearch);
  const recommendedActions = actionsFor(input, plan, includeResearch);
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
    confidence: confidenceFor(input, includeResearch),
    limitations,
    recommendedActions,
    followUpSuggestions: [],
    narrationSegments: [],
    motionTimeline: [],
    playback: createPlayback('draft', []),
  };
  draft.followUpSuggestions = defaultFollowUps(draft);
  draft.narrationSegments = buildNarrationSegments(draft);
  draft.motionTimeline = buildMotionTimeline(draft.narrationSegments, options);
  draft.playback = createPlayback(draft.id, draft.narrationSegments);
  return draft;
}

function titleFor(input: PresentationInput, plan: PresentationPlan): string {
  if (shouldAttachResearch(input, plan) && input.research?.query) return clip(input.research.query, 72);
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
  if (shouldAttachResearch(input, plan) && input.research?.sources?.length) return `${input.research.sources.length} sources`;
  if (plan.reason) return plan.reason.replace(/_/g, ' ');
  return undefined;
}

function summaryFor(input: PresentationInput, reply: string, includeResearch = true): string {
  if (includeResearch && input.research?.synthesis) return clip(input.research.synthesis, 360);
  if (input.workOutcome?.verification) {
    return clip([input.workOutcome.text, input.workOutcome.verification].filter(Boolean).join(' '), 360);
  }
  if (input.systemSnapshot?.cpu || input.systemSnapshot?.ram || input.systemSnapshot?.disk || input.systemSnapshot?.gpu) {
    return clip(systemSummary(input.systemSnapshot) || input.systemSnapshot?.summary || reply, 360);
  }
  if (input.systemSnapshot?.summary) return clip(input.systemSnapshot.summary, 360);
  if (input.displays) {
    const count = input.displays.count;
    const current = input.displays.currentName || input.displays.currentId;
    const where = current
      ? `Jarvis is on ${current}.`
      : (typeof count === 'number' && count > 0 ? '' : 'Current Jarvis display is unknown.');
    const countText = typeof count === 'number' && count > 0
      ? `${count} display${count === 1 ? '' : 's'} visible.`
      : '';
    return clip(`${where} ${countText} ${input.displays.reason || ''}`.trim(), 360);
  }
  if (reply) return clip(reply, 360);
  return clip(input.text, 360);
}

function evidenceFor(input: PresentationInput, includeResearch = true): PresentationEvidenceRef[] {
  const fromResearch = includeResearch
    ? (input.research?.sources ?? []).slice(0, 8).map(source => ({
      id: source.sourceId,
      label: source.title || source.domain || source.url,
      url: source.url,
    }))
    : [];
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
  includeResearch = true,
): PresentationCard[] {
  const cards: PresentationCard[] = [];
  const findings = includeResearch ? findingsFor(input) : [];
  for (const item of findings) {
    cards.push({
      id: item.evidenceId,
      title: 'Finding',
      body: clip(item.claim, 220),
      kind: 'finding',
      refs: item.sourceId ? [item.sourceId] : undefined,
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
  for (const metric of systemMetricCards(input)) {
    cards.push(metric);
  }
  if (input.displays && typeof input.displays.count === 'number' && input.displays.count > 0) {
    const names = input.displays.names?.length
      ? input.displays.names.join(', ')
      : (input.displays.ids || []).join(', ');
    cards.push({
      id: 'desktop.displays',
      title: 'Displays',
      body: clip(`${input.displays.count} display${input.displays.count === 1 ? '' : 's'}${names ? `: ${names}` : ''}`, 220),
      kind: 'note',
    });
  } else if (input.displays?.currentName || input.displays?.currentId) {
    cards.push({
      id: 'desktop.displays',
      title: 'Current display',
      body: clip(`Jarvis is on ${input.displays.currentName || input.displays.currentId}.`, 220),
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
  const metricCards = cards.filter(item => item.id.startsWith('system.') || item.id === 'desktop.displays');
  const findingCards = cards
    .filter(item => (item.kind === 'finding' || item.kind === 'note') && !metricCards.some(metric => metric.id === item.id))
    .map(item => item.id);
  const sections: PresentationSection[] = [
    { id: 'sec-summary', title: 'Executive summary', kind: 'summary', body: summary },
  ];
  for (const card of metricCards) {
    sections.push({
      id: `sec-${card.id.replace(/\./g, '-')}`,
      title: card.title,
      body: card.body,
      kind: 'findings',
      cards: [card.id],
    });
  }
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
  const includeResearch = shouldAttachResearch(input, plan);
  const quality = input.research?.qualityLabel || (input.research?.sourceQuality?.length
    ? input.research.sourceQuality.map(item => item.trustClass || 'unknown').join(', ')
    : '');
  if (includeResearch && quality) {
    sections.push({
      id: 'sec-quality',
      title: 'Source quality',
      kind: 'quality',
      body: clip(quality, 280),
    });
  }
  if (includeResearch && (input.research?.timeline?.length ?? 0) > 0) {
    sections.push({
      id: 'sec-timeline',
      title: 'Timeline',
      kind: 'timeline',
      body: clip((input.research?.timeline ?? []).map(item => `${item.publishedAt || 'unknown'} ${item.label || item.sourceId}`).join(' · '), 280),
    });
  }
  const conflicts = input.research?.conflictingEvidence?.length
    ? input.research.conflictingEvidence
    : (input.research?.disagreements ?? []).map(item => item.topic);
  if (includeResearch && conflicts.length > 0) {
    sections.push({
      id: 'sec-conflicts',
      title: 'Conflicting evidence',
      kind: 'comparison',
      body: clip(conflicts.join(' | '), 320),
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
  const risks = limitationsFor(input, includeResearch);
  if (risks.length > 0) {
    sections.push({
      id: 'sec-risks',
      title: 'Risks / limitations',
      kind: 'risks',
      body: risks.join(' '),
    });
  }
  const actions = actionsFor(input, plan, includeResearch);
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
    headers: ['Source', 'Quality', 'URL'],
    rows: input.research.sources.slice(0, 6).map(item => [
      item.title || item.domain || item.sourceId,
      item.trustClass || 'unknown',
      item.url,
    ]),
  }];
}

function limitationsFor(input: PresentationInput, includeResearch = true): string[] {
  const items = [...(includeResearch ? (input.research?.limitations ?? input.research?.uncertainty ?? []) : [])];
  if (input.workOutcome?.outcome === 'PARTIAL' || input.workOutcome?.outcome === 'DEGRADED') {
    items.push('This result is partial or degraded. Do not treat it as complete.');
  }
  if (includeResearch && input.research?.sources?.length) {
    items.push('Web sources are untrusted external data. Citations are not invented.');
  }
  if (input.displays?.reason) items.push(input.displays.reason);
  return unique(items).slice(0, 6);
}

function actionsFor(input: PresentationInput, plan: PresentationPlan, includeResearch = true): string[] {
  if (plan.mode === 'recommendation' || plan.mode === 'walkthrough') {
    return unique([
      ...(input.workOutcome?.observations ?? []).slice(0, 2),
      'Review the evidence before acting.',
    ]).slice(0, 4);
  }
  if (input.capabilityId?.startsWith('desktop.') && input.displays?.reason) {
    return ['Use Presenter Mode in the lab if the browser host cannot move the window.'];
  }
  if (includeResearch && input.research?.recommendedFollowUps?.length) {
    return unique(input.research.recommendedFollowUps).slice(0, 4);
  }
  if (includeResearch && input.research?.sources?.[0]) {
    return ['Open a cited source only after you choose it.', 'Ask to compare two sources if needed.'];
  }
  return [];
}

function confidenceFor(input: PresentationInput, includeResearch = true): PresentationModel['confidence'] | undefined {
  if (includeResearch && input.research?.uncertainty?.length) {
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

function findingsFor(input: PresentationInput): Array<{ evidenceId: string; claim: string; sourceId: string }> {
  const claims = (input.research?.claims ?? [])
    .filter(item => item.text)
    .slice(0, 6)
    .map((item, index) => ({
      evidenceId: `claim-${index}`,
      claim: item.text,
      sourceId: item.supportingSourceIds?.[0] || item.conflictingSourceIds?.[0] || '',
    }));
  if (claims.length > 0) return claims;
  return (input.research?.evidence ?? []).slice(0, 6);
}

function shouldAttachResearch(input: PresentationInput, plan: PresentationPlan): boolean {
  if (input.capabilityId && !input.capabilityId.startsWith('research.')) return false;
  const route = String(input.route || '').toUpperCase();
  if (route === 'CAPABILITY' || route === 'CONVERSATION') return false;
  return Boolean(input.research) && (plan.reason.startsWith('research') || plan.mode === 'comparison');
}

function systemMetricCards(input: PresentationInput): PresentationCard[] {
  const snapshot = input.systemSnapshot;
  if (!snapshot) return [];
  const cards: PresentationCard[] = [];
  if (snapshot.cpu) {
    cards.push({
      id: 'system.cpu',
      title: 'CPU',
      body: `CPU ${snapshot.cpu.usagePct}% · ${snapshot.cpu.cores} cores`,
      kind: 'note',
    });
  }
  if (snapshot.ram) {
    const free = snapshot.ram.freeMb !== undefined ? ` · ${snapshot.ram.freeMb} MB free` : '';
    cards.push({
      id: 'system.memory',
      title: 'Memory',
      body: `RAM ${snapshot.ram.usedPct}% used${free}`,
      kind: 'note',
    });
  }
  if (snapshot.disk) {
    const body = snapshot.disk.freeGb !== undefined
      ? `Disk ${snapshot.disk.freeGb} GB free`
      : `Disk ${snapshot.disk.usedPct}% used`;
    cards.push({
      id: 'system.disk',
      title: 'Disk',
      body,
      kind: 'note',
    });
  }
  if (snapshot.gpu) {
    const util = snapshot.gpu.utilizationPct !== undefined ? ` · ${snapshot.gpu.utilizationPct}%` : '';
    cards.push({
      id: 'system.gpu',
      title: 'GPU',
      body: `GPU ${snapshot.gpu.name}${util}`,
      kind: 'note',
    });
  }
  return cards;
}

function systemSummary(snapshot: NonNullable<PresentationInput['systemSnapshot']>): string {
  return [
    snapshot.cpu ? `CPU ${snapshot.cpu.usagePct}% (${snapshot.cpu.cores} cores)` : undefined,
    snapshot.ram ? `RAM ${snapshot.ram.usedPct}% used` : undefined,
    snapshot.disk ? (snapshot.disk.freeGb !== undefined ? `Disk ${snapshot.disk.freeGb} GB free` : `Disk ${snapshot.disk.usedPct}% used`) : undefined,
    snapshot.gpu ? `GPU ${snapshot.gpu.name}${snapshot.gpu.utilizationPct !== undefined ? ` ${snapshot.gpu.utilizationPct}%` : ''}` : undefined,
  ].filter(Boolean).join(' · ');
}

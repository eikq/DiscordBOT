import type { LabResearchEvidence, LabResearchSnapshot, LabResearchSource } from '../../labViewModels';
import { presenceQualityBudget, type PresenceQualityTier } from './presenceQuality';
import type { ResearchVisualStage } from './researchEvents';

export type ResearchSourceVisual =
  | 'DISCOVERED'
  | 'FETCHING'
  | 'RECEIVED'
  | 'READING'
  | 'EVIDENCE_FOUND'
  | 'VERIFIED'
  | 'UNTRUSTED'
  | 'CONFLICTING'
  | 'FAILED';

export type PresenceResearchNode = {
  id: string;
  title: string;
  domain?: string;
  url?: string;
  visual: ResearchSourceVisual;
  trust: 'verified' | 'untrusted' | 'unknown';
  excerpt?: string;
  sourceClass?: string;
};

export type PresenceResearchLink = {
  id: string;
  from: string;
  to: string;
  kind: 'agreement' | 'conflict' | 'verified';
};

export type PresenceResearchView = {
  query: string;
  stageLabel: string;
  nodes: PresenceResearchNode[];
  overflow: number;
  links: PresenceResearchLink[];
  counts: {
    sources: number;
    reviewed: number;
    evidence: number;
    verified: number;
    conflicts: number;
    untrusted: number;
  };
  degraded: boolean;
  unavailable: boolean;
  reason?: string;
  complete: boolean;
  partial: boolean;
};

export type HonestProgress =
  | { kind: 'none' }
  | { kind: 'steps'; done: number; total: number; label: string }
  | { kind: 'unknown'; label: string };

const DEFAULT_NODE_CAP = 8;

export function classifyResearchSource(
  source: Pick<LabResearchSource, 'sourceId' | 'status' | 'sourceClass' | 'fetchedAt' | 'domain' | 'title'>,
  evidence: Array<Pick<LabResearchEvidence, 'sourceId' | 'kind' | 'excerpt'>> = [],
): Pick<PresenceResearchNode, 'visual' | 'trust'> {
  const related = evidence.filter(item => item.sourceId === source.sourceId);
  const conflicting = related.some(item => item.kind === 'CONFLICTING');
  const uncertain = related.some(item => item.kind === 'UNCERTAIN' || item.kind === 'INFERENCE');
  const supported = related.some(item => item.kind === 'SOURCE_SUPPORTED');
  const official = /PRIMARY|OFFICIAL|ACADEMIC/.test(source.sourceClass);

  if (source.status === 'failed') return { visual: 'FAILED', trust: 'unknown' };
  if (source.status === 'blocked' || source.status === 'unsupported') return { visual: 'UNTRUSTED', trust: 'untrusted' };
  if (conflicting) return { visual: 'CONFLICTING', trust: uncertain ? 'untrusted' : 'unknown' };
  if (uncertain) return { visual: 'UNTRUSTED', trust: 'untrusted' };
  if (source.status === 'listed' && !source.fetchedAt) return { visual: 'DISCOVERED', trust: 'unknown' };
  if (source.status === 'listed') return { visual: 'FETCHING', trust: 'unknown' };
  if (supported && official) return { visual: 'VERIFIED', trust: 'verified' };
  if (supported) return { visual: 'EVIDENCE_FOUND', trust: 'unknown' };
  if (related.length) return { visual: 'READING', trust: 'unknown' };
  if (source.status === 'fetched') return { visual: 'RECEIVED', trust: 'unknown' };
  return { visual: 'DISCOVERED', trust: 'unknown' };
}

export function presentResearch(
  snapshot: LabResearchSnapshot | null | undefined,
  options: {
    live?: boolean;
    stage?: ResearchVisualStage | null;
    quality?: PresenceQualityTier;
    nodeCap?: number;
  } = {},
): PresenceResearchView | null {
  if (!snapshot) return null;
  if (!snapshot.attached || !snapshot.healthy) {
    return {
      query: snapshot.last?.query ?? '',
      stageLabel: snapshot.healthy ? 'RESEARCH UNAVAILABLE' : 'RESEARCH DEGRADED',
      nodes: [],
      overflow: 0,
      links: [],
      counts: { sources: 0, reviewed: 0, evidence: 0, verified: 0, conflicts: 0, untrusted: 0 },
      degraded: !snapshot.healthy,
      unavailable: !snapshot.attached || !snapshot.healthy,
      reason: snapshot.reason || 'Research provider is unavailable.',
      complete: false,
      partial: false,
    };
  }
  const last = snapshot.last;
  if (!last && !options.live) return null;

  const cap = options.nodeCap ?? presenceQualityBudget(options.quality ?? 'HIGH').visibleNodeCap ?? DEFAULT_NODE_CAP;
  const sources = last?.sources ?? [];
  const evidence = last?.evidence ?? [];
  const nodes = sources.map(source => {
    const classified = classifyResearchSource(source, evidence);
    const excerpt = evidence.find(item => item.sourceId === source.sourceId)?.excerpt;
    return {
      id: source.sourceId,
      title: source.title || source.domain || 'Source',
      domain: source.domain,
      url: source.url,
      sourceClass: source.sourceClass,
      excerpt,
      ...classified,
    } satisfies PresenceResearchNode;
  });

  const conflicts = nodes.filter(node => node.visual === 'CONFLICTING').length
    + (last?.uncertainty.filter(item => /conflict|disagree/i.test(item)).length ?? 0);
  const verified = nodes.filter(node => node.trust === 'verified').length;
  const untrusted = nodes.filter(node => node.trust === 'untrusted').length;
  const reviewed = sources.filter(source => source.status === 'fetched' || source.status === 'failed' || source.status === 'blocked').length;
  const visible = nodes.slice(0, cap);
  const overflow = Math.max(0, nodes.length - visible.length);
  const links = buildResearchLinks(visible, evidence);

  const stages = last?.stages ?? [];
  const failed = stages.some(stage => stage.state === 'failed') || options.stage === 'RESEARCH_FAILED';
  const allDone = stages.length > 0 && stages.every(stage => stage.state === 'done' || stage.state === 'empty');
  const complete = options.stage === 'RESEARCH_COMPLETED' || (allDone && !options.live);
  const synthesis = stages.some(stage => stage.id === 'synthesis' && stage.state === 'active');

  return {
    query: last?.query ?? '',
    stageLabel: researchStageLabel(options.stage, {
      failed,
      complete,
      partial: complete && (conflicts > 0 || Boolean(last?.uncertainty.length)),
      synthesis,
      live: Boolean(options.live),
      unavailable: false,
    }),
    nodes: visible,
    overflow,
    links,
    counts: {
      sources: sources.length,
      reviewed,
      evidence: evidence.length,
      verified,
      conflicts,
      untrusted,
    },
    degraded: failed,
    unavailable: false,
    reason: failed ? (snapshot.reason || 'A research source or provider failed.') : undefined,
    complete,
    partial: complete && (conflicts > 0 || Boolean(last?.uncertainty.length)),
  };
}

export function researchStageLabel(
  stage: ResearchVisualStage | null | undefined,
  flags: { failed?: boolean; complete?: boolean; partial?: boolean; synthesis?: boolean; live?: boolean; unavailable?: boolean },
): string {
  if (flags.unavailable) return 'RESEARCH UNAVAILABLE';
  if (flags.failed || stage === 'RESEARCH_FAILED') return 'RESEARCH DEGRADED';
  if (flags.complete) return flags.partial ? 'PARTIALLY VERIFIED' : 'COMPLETE';
  switch (stage) {
    case 'SOURCE_DISCOVERED':
    case 'SOURCE_FETCH_STARTED':
    case 'SOURCE_RECEIVED':
    case 'SOURCE_CLASSIFIED':
      return 'GATHERING SOURCES';
    case 'EVIDENCE_UPDATED':
      return 'READING EVIDENCE';
    case 'CONFLICT_UPDATED':
      return 'COMPARING EVIDENCE';
    case 'SYNTHESIS_STARTED':
      return 'SYNTHESIZING';
    case 'RESEARCH_VERIFICATION_STARTED':
      return 'VERIFYING SOURCES';
    case 'RESEARCH_STARTED':
      return 'RESEARCHING';
    default:
      if (flags.synthesis) return 'SYNTHESIZING';
      if (flags.live) return 'RESEARCHING';
      return 'RESEARCHING';
  }
}

export function buildResearchLinks(
  nodes: PresenceResearchNode[],
  evidence: Array<Pick<LabResearchEvidence, 'sourceId' | 'kind'>>,
): PresenceResearchLink[] {
  const links: PresenceResearchLink[] = [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const conflicting = nodes.filter(node => node.visual === 'CONFLICTING');
  for (let index = 1; index < conflicting.length; index += 1) {
    const previous = conflicting[index - 1]!;
    const current = conflicting[index]!;
    links.push({ id: `conflict:${previous.id}:${current.id}`, from: previous.id, to: current.id, kind: 'conflict' });
  }
  const supported = evidence.filter(item => item.kind === 'SOURCE_SUPPORTED').map(item => item.sourceId);
  for (let index = 1; index < supported.length; index += 1) {
    const from = supported[index - 1]!;
    const to = supported[index]!;
    if (!byId.has(from) || !byId.has(to)) continue;
    if (byId.get(from)?.visual === 'CONFLICTING' || byId.get(to)?.visual === 'CONFLICTING') continue;
    links.push({ id: `agree:${from}:${to}`, from, to, kind: byId.get(to)?.trust === 'verified' ? 'verified' : 'agreement' });
  }
  return links.slice(0, 10);
}

export function coalesceResearchNodes(
  current: PresenceResearchNode[],
  incoming: PresenceResearchNode[],
): PresenceResearchNode[] {
  const merged = new Map(current.map(node => [node.id, node]));
  for (const node of incoming) merged.set(node.id, node);
  return [...merged.values()];
}

export function honestTaskProgress(input: {
  stepsDone?: number;
  stepsTotal?: number;
  phaseLabel?: string;
}): HonestProgress {
  const total = input.stepsTotal;
  const done = input.stepsDone;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) {
    return { kind: 'unknown', label: input.phaseLabel || 'In progress' };
  }
  if (typeof done !== 'number' || !Number.isFinite(done) || done < 0) {
    return { kind: 'steps', done: 0, total, label: `0 / ${total}` };
  }
  return { kind: 'steps', done: Math.min(done, total), total, label: `${Math.min(done, total)} / ${total}` };
}

export function honestProgressPercent(progress: HonestProgress): number | null {
  if (progress.kind !== 'steps' || progress.total <= 0) return null;
  return Math.round((progress.done / progress.total) * 100);
}

export function boundVisibleNodes<T>(items: T[], cap = DEFAULT_NODE_CAP): { visible: T[]; overflow: number } {
  const safe = Math.max(1, cap);
  return { visible: items.slice(0, safe), overflow: Math.max(0, items.length - safe) };
}

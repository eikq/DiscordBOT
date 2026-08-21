/**
 * Developer-only cinematic replay. Never applied to /jarvis without an explicit query.
 * Does not create capabilities, mutate production stores, or claim REAL status.
 */

import type { LabResearchEvidence, LabResearchSnapshot, LabResearchSource } from '../../labViewModels';
import type { ResearchVisualStage } from './researchEvents';

export const REPLAY_BANNER = 'DEVELOPMENT REPLAY' as const;

export type ReplaySpeed = 0.5 | 1 | 2;

export type PresenceReplayCue = {
  atMs: number;
  stage: ResearchVisualStage;
  source?: Partial<LabResearchSource> & Pick<LabResearchSource, 'sourceId' | 'title' | 'domain' | 'status' | 'sourceClass'>;
  evidence?: Pick<LabResearchEvidence, 'evidenceId' | 'sourceId' | 'excerpt' | 'kind'>;
  uncertainty?: string;
};

export type PresenceReplayState = {
  label: typeof REPLAY_BANNER;
  simulated: true;
  speed: ReplaySpeed;
  elapsedMs: number;
  stage: ResearchVisualStage | null;
  snapshot: LabResearchSnapshot;
  complete: boolean;
};

function source(partial: PresenceReplayCue['source']): LabResearchSource {
  const domain = partial!.domain;
  return {
    sourceId: partial!.sourceId,
    url: `https://${domain}/replay`,
    canonicalUrl: `https://${domain}/replay`,
    domain,
    title: partial!.title,
    publishedAt: '2026-08-21T00:00:00.000Z',
    fetchedAt: partial!.status === 'fetched' || partial!.status === 'failed' ? '2026-08-21T00:00:00.000Z' : null,
    sourceClass: partial!.sourceClass,
    status: partial!.status,
    cached: false,
  };
}

/** Sanitized structured sequence for visual tuning. Not a live run and not REAL. */
export const QWEN_DOCS_REPLAY: PresenceReplayCue[] = [
  { atMs: 0, stage: 'RESEARCH_STARTED' },
  {
    atMs: 700,
    stage: 'SOURCE_DISCOVERED',
    source: { sourceId: 'official', title: 'Qwen official docs', domain: 'qwenlm.github.io', status: 'listed', sourceClass: 'OFFICIAL' },
  },
  {
    atMs: 1400,
    stage: 'SOURCE_DISCOVERED',
    source: { sourceId: 'github', title: 'Qwen repository', domain: 'github.com', status: 'listed', sourceClass: 'PRIMARY' },
  },
  { atMs: 1900, stage: 'SOURCE_FETCH_STARTED' },
  {
    atMs: 2500,
    stage: 'SOURCE_RECEIVED',
    source: { sourceId: 'official', title: 'Qwen official docs', domain: 'qwenlm.github.io', status: 'fetched', sourceClass: 'OFFICIAL' },
  },
  {
    atMs: 3100,
    stage: 'SOURCE_RECEIVED',
    source: { sourceId: 'github', title: 'Qwen repository', domain: 'github.com', status: 'fetched', sourceClass: 'PRIMARY' },
  },
  {
    atMs: 3600,
    stage: 'SOURCE_DISCOVERED',
    source: { sourceId: 'news', title: 'Model release notes', domain: 'example-news.test', status: 'listed', sourceClass: 'NEWS' },
  },
  {
    atMs: 4200,
    stage: 'EVIDENCE_UPDATED',
    evidence: { evidenceId: 'e1', sourceId: 'official', excerpt: 'Vendor documents the current Qwen release.', kind: 'SOURCE_SUPPORTED' },
  },
  {
    atMs: 4800,
    stage: 'SOURCE_RECEIVED',
    source: { sourceId: 'news', title: 'Model release notes', domain: 'example-news.test', status: 'fetched', sourceClass: 'NEWS' },
  },
  {
    atMs: 5400,
    stage: 'EVIDENCE_UPDATED',
    evidence: { evidenceId: 'e2', sourceId: 'github', excerpt: 'Repository lists release artifacts.', kind: 'SOURCE_SUPPORTED' },
  },
  {
    atMs: 6100,
    stage: 'SOURCE_DISCOVERED',
    source: { sourceId: 'blog', title: 'Independent writeup', domain: 'blog.example', status: 'fetched', sourceClass: 'UNKNOWN' },
  },
  {
    atMs: 6800,
    stage: 'CONFLICT_UPDATED',
    evidence: { evidenceId: 'e3', sourceId: 'blog', excerpt: 'Writeup disagrees with the official version string.', kind: 'CONFLICTING' },
    uncertainty: 'One independent writeup conflicts with vendor docs.',
  },
  { atMs: 7600, stage: 'SYNTHESIS_STARTED' },
  { atMs: 8600, stage: 'RESEARCH_VERIFICATION_STARTED' },
  { atMs: 9800, stage: 'RESEARCH_COMPLETED' },
];

export function parsePresenceReplay(search: string): { speed: ReplaySpeed } | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (raw.get('visualReplay') !== '1') return null;
  const speedRaw = raw.get('replaySpeed');
  const speed = speedRaw === '0.5' ? 0.5 : speedRaw === '2' ? 2 : 1;
  return { speed };
}

export function replayMustNotEnterProduction(search: string): boolean {
  return parsePresenceReplay(search) === null;
}

export function replayResearchAt(elapsedMs: number, cues: PresenceReplayCue[] = QWEN_DOCS_REPLAY): PresenceReplayState {
  const safeElapsed = Math.max(0, elapsedMs);
  const sources = new Map<string, LabResearchSource>();
  const evidence: LabResearchEvidence[] = [];
  const uncertainty: string[] = [];
  let stage: ResearchVisualStage | null = null;
  for (const cue of cues) {
    if (cue.atMs > safeElapsed) break;
    stage = cue.stage;
    if (cue.source) sources.set(cue.source.sourceId, source(cue.source));
    if (cue.evidence) {
      evidence.push({
        evidenceId: cue.evidence.evidenceId,
        sourceId: cue.evidence.sourceId,
        excerpt: cue.evidence.excerpt,
        publishedAt: null,
        fetchedAt: null,
        kind: cue.evidence.kind,
      });
    }
    if (cue.uncertainty) uncertainty.push(cue.uncertainty);
  }
  const complete = stage === 'RESEARCH_COMPLETED' || stage === 'RESEARCH_FAILED';
  return {
    label: REPLAY_BANNER,
    simulated: true,
    speed: 1,
    elapsedMs: safeElapsed,
    stage,
    complete,
    snapshot: {
      attached: true,
      healthy: true,
      last: {
        query: 'Qwen documentation',
        sources: [...sources.values()],
        evidence,
        stages: [
          { id: 'search', label: 'Search', detail: 'Replay search', state: stage ? 'done' : 'pending' },
          { id: 'fetch', label: 'Fetch', detail: 'Replay fetch', state: sources.size > 1 ? 'done' : 'active' },
          { id: 'compare', label: 'Compare', detail: uncertainty[0] || 'Replay compare', state: uncertainty.length ? 'done' : 'pending' },
          { id: 'synthesis', label: 'Synthesis', detail: 'Replay synthesis', state: complete ? 'done' : stage === 'SYNTHESIS_STARTED' ? 'active' : 'pending' },
        ],
        researchedAt: '2026-08-21T00:00:00.000Z',
        cached: false,
        uncertainty,
      },
    },
  };
}

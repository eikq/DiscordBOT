import type { LabResearchSnapshot, LabResearchSource } from '../../labViewModels';
import type { PresencePhase } from '../presenceRuntime';

export const PRESENCE_VISUAL_SCENES = [
  'idle',
  'listening',
  'thinking',
  'research',
  'research-conflict',
  'executing',
  'waiting-owner',
  'verifying',
  'verified',
  'system',
  'reminder',
  'emergency',
  'ambient',
] as const;

export type PresenceVisualScene = (typeof PRESENCE_VISUAL_SCENES)[number];

export type PresenceVisualFixture = {
  scene: PresenceVisualScene;
  label: 'DEVELOPMENT FIXTURE';
  simulated: true;
  phase: PresencePhase;
  ambient: boolean;
  systemAsked: boolean;
  reminderActive: boolean;
  emergency: boolean;
  waitingPermission: boolean;
  taskActive: boolean;
  researchLive: boolean;
  research: LabResearchSnapshot | null;
  answer?: string;
};

const FIXTURE_BANNER = 'DEVELOPMENT FIXTURE' as const;

function source(
  id: string,
  title: string,
  domain: string,
  status: string,
  sourceClass: string,
  fetched = true,
): LabResearchSource {
  return {
    sourceId: id,
    url: `https://${domain}/fixture`,
    canonicalUrl: `https://${domain}/fixture`,
    domain,
    title,
    publishedAt: '2026-08-21T00:00:00.000Z',
    fetchedAt: fetched ? '2026-08-21T00:00:00.000Z' : null,
    sourceClass,
    status,
    cached: false,
  };
}

function researchPack(kind: 'plain' | 'conflict'): LabResearchSnapshot {
  const last = {
    query: 'Qwen 3',
    sources: [
      source('official', 'Qwen official docs', 'qwenlm.github.io', 'fetched', 'OFFICIAL'),
      source('github', 'Qwen repository', 'github.com', 'fetched', 'PRIMARY'),
      source('news', 'Model release notes', 'example-news.test', 'fetched', 'NEWS'),
      source('paper', 'Technical report', 'arxiv.org', 'fetched', 'ACADEMIC'),
      source('reddit', 'Community thread', 'reddit.com', 'fetched', 'COMMUNITY'),
      source('blog', 'Independent writeup', 'blog.example', kind === 'conflict' ? 'fetched' : 'listed', 'UNKNOWN', kind === 'conflict'),
      source('docs2', 'Vendor FAQ', 'help.example', 'fetched', 'REFERENCE'),
      source('fail', 'Unreachable mirror', 'down.example', 'failed', 'UNKNOWN'),
    ],
    evidence: [
      { evidenceId: 'e1', sourceId: 'official', excerpt: 'Qwen 3 is documented by the vendor.', publishedAt: null, fetchedAt: null, kind: 'SOURCE_SUPPORTED' },
      { evidenceId: 'e2', sourceId: 'github', excerpt: 'Source repository lists Qwen 3 artifacts.', publishedAt: null, fetchedAt: null, kind: 'SOURCE_SUPPORTED' },
      { evidenceId: 'e3', sourceId: 'reddit', excerpt: 'Forum post restates the release without provenance.', publishedAt: null, fetchedAt: null, kind: 'UNCERTAIN' },
      ...(kind === 'conflict'
        ? [{
          evidenceId: 'e4',
          sourceId: 'blog',
          excerpt: 'This fixture claim disagrees with the official version string.',
          publishedAt: null,
          fetchedAt: null,
          kind: 'CONFLICTING',
        }]
        : []),
    ],
    stages: [
      { id: 'search', label: 'Search', detail: 'Fixture search', state: 'done' },
      { id: 'fetch', label: 'Fetch', detail: 'Fixture fetch', state: 'done' },
      { id: 'compare', label: 'Compare', detail: kind === 'conflict' ? '1 conflict' : 'Agreeing sources', state: kind === 'conflict' ? 'active' : 'done' },
      { id: 'synthesis', label: 'Synthesis', detail: 'Fixture synthesis', state: kind === 'conflict' ? 'pending' : 'done' },
    ],
    researchedAt: '2026-08-21T00:00:00.000Z',
    cached: false,
    uncertainty: kind === 'conflict' ? ['Fixture conflict remains unresolved.'] : [],
  };
  return { attached: true, healthy: true, last };
}

export function parsePresenceVisualScene(search: string): PresenceVisualScene | null {
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('visualScene');
  if (!raw) return null;
  return (PRESENCE_VISUAL_SCENES as readonly string[]).includes(raw) ? raw as PresenceVisualScene : null;
}

export function presenceVisualFixture(scene: PresenceVisualScene): PresenceVisualFixture {
  const base: PresenceVisualFixture = {
    scene,
    label: FIXTURE_BANNER,
    simulated: true,
    phase: 'IDLE',
    ambient: false,
    systemAsked: false,
    reminderActive: false,
    emergency: false,
    waitingPermission: false,
    taskActive: false,
    researchLive: false,
    research: null,
  };
  switch (scene) {
    case 'listening':
      return { ...base, phase: 'LISTENING' };
    case 'thinking':
      return { ...base, phase: 'THINKING' };
    case 'research':
      return { ...base, phase: 'RESEARCHING', researchLive: true, research: researchPack('plain') };
    case 'research-conflict':
      return { ...base, phase: 'RESEARCHING', researchLive: true, research: researchPack('conflict') };
    case 'executing':
      return { ...base, phase: 'EXECUTING', taskActive: true };
    case 'waiting-owner':
      return { ...base, phase: 'WAITING_OWNER', waitingPermission: true };
    case 'verifying':
      return { ...base, phase: 'VERIFYING', taskActive: true };
    case 'verified':
      return { ...base, phase: 'IDLE', answer: 'Requested change was verified.' };
    case 'system':
      return { ...base, phase: 'IDLE', systemAsked: true };
    case 'reminder':
      return { ...base, phase: 'IDLE', reminderActive: true };
    case 'emergency':
      return { ...base, phase: 'EMERGENCY_STOP', emergency: true };
    case 'ambient':
      return { ...base, ambient: true };
    default:
      return base;
  }
}

export function fixtureMustNotLeak(search: string): boolean {
  return parsePresenceVisualScene(search) === null;
}

import type { ResearchVisualStage } from './researchEvents';

export type PresenceActivityItem = {
  id: string;
  text: string;
  at: number;
};

const STAGE_LINE: Partial<Record<ResearchVisualStage, string>> = {
  RESEARCH_STARTED: 'Research started',
  SOURCE_DISCOVERED: 'Source discovered',
  SOURCE_FETCH_STARTED: 'Fetching source',
  SOURCE_RECEIVED: 'Source received',
  SOURCE_CLASSIFIED: 'Source classified',
  EVIDENCE_UPDATED: 'Evidence arriving',
  CONFLICT_UPDATED: 'Conflict detected',
  SYNTHESIS_STARTED: 'Synthesizing sources',
  RESEARCH_VERIFICATION_STARTED: 'Verification started',
  RESEARCH_COMPLETED: 'Research complete',
  RESEARCH_FAILED: 'Research degraded',
};

export function researchActivityLine(stage: ResearchVisualStage | null | undefined): string | null {
  if (!stage) return null;
  return STAGE_LINE[stage] ?? null;
}

export function pushActivityItem(
  current: PresenceActivityItem[],
  stage: ResearchVisualStage | null | undefined,
  now = Date.now(),
  limit = 3,
): PresenceActivityItem[] {
  const text = researchActivityLine(stage);
  if (!text) return current;
  const last = current[current.length - 1];
  if (last?.text === text) return current;
  return [...current, { id: `${stage}:${now}`, text, at: now }].slice(-limit);
}

export function visibleActivityItems(items: PresenceActivityItem[], now = Date.now(), lifetimeMs = 4200): PresenceActivityItem[] {
  return items.filter(item => now - item.at < lifetimeMs);
}

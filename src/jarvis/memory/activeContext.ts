/**
 * Bounded active resource context. Working/runtime only.
 */

import type { InteractionContext } from '../intent/types';
import type { SourceRecord } from '../research/types';

export const WORKING_REFERENT_TTL_MS = 10 * 60_000;
export const HIGH_RISK_REFERENT_TTL_MS = 2 * 60_000;

export type ResearchSourceRef = {
  sourceId: string;
  url: string;
  label: string;
  official: boolean;
};

export type ActiveContextPatch = Pick<InteractionContext,
  | 'lastOpenedResource'
  | 'lastDisplay'
  | 'previousDisplay'
  | 'currentWebsite'
  | 'currentApplication'
  | 'currentWindow'
  | 'currentSource'
  | 'currentResearch'
  | 'currentWorkspace'
  | 'currentDisplay'
  | 'lastResearchSources'
>;

const HIGH_RISK = /\b(delete|remove|kill|uninstall|format|erase|ลบ|ทำลาย)\b/iu;

export function isHighRiskReferentText(text: string): boolean {
  return HIGH_RISK.test(text);
}

export function referentStillValid(
  context: InteractionContext | null | undefined,
  now: number,
  options: { highRisk?: boolean } = {},
): boolean {
  if (!context) return false;
  const ttl = options.highRisk ? HIGH_RISK_REFERENT_TTL_MS : WORKING_REFERENT_TTL_MS;
  if (context.expiresAt <= now) return false;
  if (now - context.updatedAt > ttl) return false;
  if (options.highRisk && context.lastOpenedResource?.openState !== 'opened') return false;
  return true;
}

export function sourcesFromResearch(sources: SourceRecord[] | undefined): ResearchSourceRef[] {
  return (sources ?? []).slice(0, 8).map(item => ({
    sourceId: item.sourceId,
    url: item.canonicalUrl || item.url,
    label: item.title || item.domain,
    official: item.sourceClass === 'OFFICIAL' || item.sourceClass === 'PRIMARY' || item.trustSignals.officialDomain,
  }));
}

export function mergeResearchIntoContext(
  context: InteractionContext | null | undefined,
  last: { query?: string; sessionId?: string; sources?: SourceRecord[] } | undefined,
  sessionId?: string,
): InteractionContext | null {
  const sources = sourcesFromResearch(last?.sources);
  if (!context && !sources.length) return context ?? null;
  if (!context) {
    const now = Date.now();
    return {
      sessionId: sessionId || last?.sessionId || 'research',
      updatedAt: now,
      expiresAt: now + WORKING_REFERENT_TTL_MS,
      lastResearchSources: sources,
      currentResearch: last?.query,
      recentResearchQuery: last?.query,
      recentResearchSessionId: last?.sessionId,
      currentSource: sources.length === 1 ? sources[0]!.url : undefined,
    };
  }
  return {
    ...context,
    lastResearchSources: context.lastResearchSources?.length ? context.lastResearchSources : sources,
    currentResearch: context.currentResearch || last?.query,
    recentResearchQuery: context.recentResearchQuery || last?.query,
    recentResearchSessionId: context.recentResearchSessionId || last?.sessionId,
    currentSource: context.currentSource || (sources.length === 1 ? sources[0]!.url : undefined),
  };
}

export function resolveOfficialSources(sources: ResearchSourceRef[]): ResearchSourceRef[] {
  return sources.filter(item => item.official);
}

function sourceNeedles(source: ResearchSourceRef): string[] {
  const needles: string[] = [];
  try {
    const host = new URL(source.url).hostname.replace(/^www\./iu, '').toLowerCase();
    needles.push(host);
    for (const part of host.split('.')) {
      if (part.length >= 5) needles.push(part);
    }
  } catch {
    /* ignore invalid URL */
  }
  const label = source.label.trim().toLowerCase();
  if (label.length >= 5) needles.push(label);
  return [...new Set(needles)];
}

export function pickSourceByMention(
  sources: ResearchSourceRef[] | undefined,
  text: string,
): ResearchSourceRef | undefined {
  const hay = text.toLowerCase();
  const scored = (sources ?? []).map(item => {
    const matched = sourceNeedles(item).filter(needle => hay.includes(needle));
    return { item, best: matched.reduce((max, needle) => Math.max(max, needle.length), 0) };
  }).filter(row => row.best > 0);
  if (!scored.length) return undefined;
  scored.sort((a, b) => b.best - a.best);
  if (scored.length === 1 || scored[0]!.best > scored[1]!.best) return scored[0]!.item;
  return undefined;
}

function formatSourceChoices(sources: ResearchSourceRef[]): string {
  return sources.map(item => `${item.label} (${item.url})`).join('; ');
}

export function resolveThatSource(
  sources: ResearchSourceRef[] | undefined,
  mention?: string,
): { ok: true; source: ResearchSourceRef } | { ok: false; reasonCode: 'NO_RESEARCH_SOURCE' | 'AMBIGUOUS_SOURCE'; message: string; candidates?: ResearchSourceRef[] } {
  const list = sources ?? [];
  if (!list.length) {
    return { ok: false, reasonCode: 'NO_RESEARCH_SOURCE', message: 'I do not have a current research source to open.' };
  }
  const mentioned = mention ? pickSourceByMention(list, mention) : undefined;
  if (mentioned) return { ok: true, source: mentioned };
  const official = resolveOfficialSources(list);
  if (official.length === 1) return { ok: true, source: official[0]! };
  if (official.length > 1) {
    return {
      ok: false,
      reasonCode: 'AMBIGUOUS_SOURCE',
      message: `I found ${official.length} official sources: ${formatSourceChoices(official)}. Which one should I open?`,
      candidates: official,
    };
  }
  if (list.length === 1) return { ok: true, source: list[0]! };
  return {
    ok: false,
    reasonCode: 'AMBIGUOUS_SOURCE',
    message: `I have more than one recent source: ${formatSourceChoices(list)}. Which one do you mean?`,
    candidates: list,
  };
}

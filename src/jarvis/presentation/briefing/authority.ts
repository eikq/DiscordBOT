import { isPresentationFollowUp } from './followUp';
import type { PresentationFollowUpId, PresentationModel } from './types';

export type PresenterAuthority =
  | { kind: 'local'; action: PresentationFollowUpId; reason: 'presenter_local' }
  | { kind: 'route'; reason: 'needs_new_information' | 'needs_new_tool' };

const NEW_FACTS = /\b(latest|ล่าสุด|docs?|documentation|paper|official|look up|search the web|ค้นคว้า)\b/iu;
const SUPPLIED = /\b(those|these|this section|the two|current (metrics|results|data)|existing|สองแหล่งนี้|ผลนี้|จากข้อมูลนี้|ใน briefing)\b/iu;

/**
 * Presenter-local interactions may only reshape the current briefing.
 * New facts or new tools go back through the normal Jarvis router.
 */
export function classifyPresenterAuthority(
  text: string,
  model?: PresentationModel,
): PresenterAuthority {
  const raw = String(text || '').trim();
  if (isPresentationFollowUp(raw)) {
    if (raw === 'compare' && needsNewComparisonFacts(raw, model)) {
      return { kind: 'route', reason: 'needs_new_information' };
    }
    return { kind: 'local', action: raw, reason: 'presenter_local' };
  }
  if (/^(explain|expand|shorten|repeat|back|show source|focus on recommendations)$/iu.test(raw)) {
    const mapped = mapPhrase(raw);
    if (mapped) return { kind: 'local', action: mapped, reason: 'presenter_local' };
  }
  if (/\bcompar(e|ison)\b|เทียบ/iu.test(raw)) {
    if (NEW_FACTS.test(raw) && !hasExistingComparison(model)) {
      return { kind: 'route', reason: 'needs_new_information' };
    }
    if (SUPPLIED.test(raw) || hasExistingComparison(model)) {
      return { kind: 'local', action: 'compare', reason: 'presenter_local' };
    }
    return { kind: 'route', reason: 'needs_new_information' };
  }
  return { kind: 'route', reason: 'needs_new_tool' };
}

function hasExistingComparison(model?: PresentationModel): boolean {
  if (!model) return false;
  return model.mode === 'comparison'
    || model.evidence.length >= 2
    || model.sections.some(item => item.kind === 'comparison');
}

function needsNewComparisonFacts(text: string, model?: PresentationModel): boolean {
  return NEW_FACTS.test(text) && !hasExistingComparison(model);
}

function mapPhrase(text: string): PresentationFollowUpId | undefined {
  const lower = text.trim().toLowerCase();
  if (lower === 'explain') return 'explain';
  if (lower === 'expand') return 'expand';
  if (lower === 'shorten') return 'shorten';
  if (lower === 'repeat') return 'repeat';
  if (lower === 'back') return 'back';
  if (lower === 'show source') return 'show-source';
  if (lower === 'focus on recommendations') return 'focus-recommendations';
  return undefined;
}

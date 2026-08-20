export type ComparisonIntentKind = 'supplied_data' | 'needs_external_facts' | 'none';

const COMPARE = /\bcompar(e|ison|ing)\b|เทียบ|versus|\bvs\.?\b|ต่างจาก/iu;
const SUPPLIED = /\b(those|these|this result|the two|current (metrics|results|data|status)|existing|สองแหล่งนี้|ผลนี้|จากข้อมูลนี้|in this briefing)\b/iu;
const EXTERNAL = /\b(latest|ล่าสุด|docs?|documentation|paper|official|look up|search the web|ค้นคว้า)\b/iu;

/**
 * Comparison from already-supplied data does not mint a research tool call.
 * Comparison that needs new external facts goes through the normal router.
 * The word "compare" alone is not an automatic web-research request.
 */
export function classifyComparisonIntent(text: string): ComparisonIntentKind {
  const raw = String(text || '').trim();
  if (!COMPARE.test(raw)) return 'none';
  if (SUPPLIED.test(raw) && !EXTERNAL.test(raw)) return 'supplied_data';
  if (EXTERNAL.test(raw)) return 'needs_external_facts';
  return 'supplied_data';
}

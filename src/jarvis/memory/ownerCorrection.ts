import { canonicalMemoryId } from '../../bot/memory/jarvis/ids';
import { inferMemoryClass } from '../../bot/memory/jarvis/memoryClass';
import { defaultRetention } from '../../bot/memory/jarvis/semantics';
import type { JarvisMemoryStore } from '../../bot/memory/jarvis/store';
import { MemoryConflictError } from '../../bot/memory/jarvis/types';
import type { SemanticFactRecord } from '../../bot/memory/jarvis/types';

export const OWNER_CORRECTION_ACTIONS = ['remember', 'reject', 'change', 'forget', 'none'] as const;
export type OwnerCorrectionAction = (typeof OWNER_CORRECTION_ACTIONS)[number];

export type ParsedOwnerCorrection = {
  action: OwnerCorrectionAction;
  remainder: string;
  factKey?: string;
  value?: string;
};

export type OwnerCorrectionResult = {
  action: OwnerCorrectionAction;
  applied: boolean;
  factIds: string[];
  detail: string;
};

const CHANGE = /^(?:เปลี่ยนเป็น|change(?:\s+it)?\s+to|change)\s*[:\s]*(.+)$/iu;
const FORGET = /^(?:ลืม(?:เรื่องนี้)?|forget(?:\s+(?:this|that|it))?)\s*[:\s]*(.*)$/iu;
const REJECT = /^(?:อันนี้ไม่ใช่|that(?:'s| is) not(?: right| true| it)?|not this)\s*[:\s]*(.*)$/iu;
const REMEMBER = /^(?:จำ(?:อันนี้|ไว้)?|remember(?:\s+(?:this|that|it))?)\s*[:\s]*(.+)$/iu;

export function parseOwnerCorrection(text: string): ParsedOwnerCorrection {
  const trimmed = String(text || '').trim();
  if (!trimmed) return { action: 'none', remainder: '' };
  const change = trimmed.match(CHANGE);
  if (change) return withAssignment('change', change[1]);
  const forget = trimmed.match(FORGET);
  if (forget) return withAssignment('forget', forget[1] || '');
  const reject = trimmed.match(REJECT);
  if (reject) return withAssignment('reject', reject[1] || '');
  const remember = trimmed.match(REMEMBER);
  if (remember) return withAssignment('remember', remember[1]);
  return { action: 'none', remainder: trimmed };
}

export function applyOwnerCorrection(
  store: JarvisMemoryStore,
  text: string,
  actor = 'owner',
): OwnerCorrectionResult {
  const parsed = parseOwnerCorrection(text);
  if (parsed.action === 'none') {
    return { action: 'none', applied: false, factIds: [], detail: 'not_an_owner_correction' };
  }
  if (parsed.action === 'remember') {
    return rememberFact(store, parsed, actor);
  }
  if (parsed.action === 'change') {
    return changeFact(store, parsed, actor);
  }
  if (parsed.action === 'forget' || parsed.action === 'reject') {
    return forgetMatching(store, parsed, actor);
  }
  return { action: parsed.action, applied: false, factIds: [], detail: 'unsupported' };
}

function withAssignment(action: OwnerCorrectionAction, remainder: string): ParsedOwnerCorrection {
  const clean = remainder.trim();
  const assignment = parseAssignment(clean);
  return { action, remainder: clean, factKey: assignment?.factKey, value: assignment?.value };
}

function parseAssignment(text: string): { factKey: string; value: string } | undefined {
  const match = text.match(/^([a-z][a-z0-9_.-]*)\s*(?:=|:|is|เป็น|to)\s*(.+)$/iu);
  if (!match) return undefined;
  return { factKey: match[1].toLowerCase(), value: match[2].trim() };
}

function rememberFact(
  store: JarvisMemoryStore,
  parsed: ParsedOwnerCorrection,
  actor: string,
): OwnerCorrectionResult {
  if (!parsed.factKey || !parsed.value) {
    return { action: 'remember', applied: false, factIds: [], detail: 'missing_fact_assignment' };
  }
  const fact = writeOwnerFact(store, parsed.factKey, parsed.value, actor, 'remember');
  return { action: 'remember', applied: true, factIds: [fact.id], detail: 'remembered' };
}

function changeFact(
  store: JarvisMemoryStore,
  parsed: ParsedOwnerCorrection,
  actor: string,
): OwnerCorrectionResult {
  if (!parsed.factKey || !parsed.value) {
    return { action: 'change', applied: false, factIds: [], detail: 'missing_fact_assignment' };
  }
  const active = store.listFacts({ factKey: parsed.factKey, status: 'active', limit: 8 });
  if (active.length === 0) {
    const fact = writeOwnerFact(store, parsed.factKey, parsed.value, actor, 'correct');
    return { action: 'change', applied: true, factIds: [fact.id], detail: 'created' };
  }
  const ids: string[] = [];
  for (const previous of active) {
    if (previous.objectValue === parsed.value) {
      ids.push(previous.id);
      continue;
    }
    const next = ownerFactRecord(parsed.factKey, parsed.value, actor);
    const result = store.supersedeFact(previous.id, next);
    store.putFeedback(result.next.id, 'correct', `changed from ${previous.objectValue}`, actor);
    ids.push(result.previous.id, result.next.id);
  }
  return { action: 'change', applied: true, factIds: ids, detail: 'superseded' };
}

function forgetMatching(
  store: JarvisMemoryStore,
  parsed: ParsedOwnerCorrection,
  actor: string,
): OwnerCorrectionResult {
  const matches = findMatches(store, parsed);
  if (matches.length === 0) {
    return { action: parsed.action, applied: false, factIds: [], detail: 'no_matching_fact' };
  }
  const ids: string[] = [];
  for (const fact of matches) {
    const forgotten = store.forget(fact.id);
    if (forgotten) {
      store.putFeedback(fact.id, 'forget', parsed.remainder || parsed.action, actor);
      ids.push(fact.id);
    }
  }
  return { action: parsed.action, applied: ids.length > 0, factIds: ids, detail: 'forgotten' };
}

function findMatches(store: JarvisMemoryStore, parsed: ParsedOwnerCorrection): SemanticFactRecord[] {
  if (parsed.factKey) {
    return store.listFacts({ factKey: parsed.factKey, status: 'active', limit: 20 });
  }
  if (!parsed.remainder) return [];
  return store.listFacts({ query: parsed.remainder, status: 'active', limit: 20 });
}

function writeOwnerFact(
  store: JarvisMemoryStore,
  factKey: string,
  value: string,
  actor: string,
  feedback: 'remember' | 'correct',
): SemanticFactRecord {
  const next = ownerFactRecord(factKey, value, actor);
  try {
    const fact = store.putFact(next);
    store.putFeedback(fact.id, feedback, value, actor);
    return fact;
  } catch (error) {
    if (error instanceof MemoryConflictError) {
      const result = store.supersedeFact(error.existingId, next);
      store.putFeedback(result.next.id, 'correct', value, actor);
      return result.next;
    }
    throw error;
  }
}

function ownerFactRecord(factKey: string, value: string, actor: string): SemanticFactRecord {
  const now = Date.now();
  return {
    id: canonicalMemoryId('fact', `${factKey}_${now}`),
    kind: 'fact',
    predicate: factKey,
    objectValue: value,
    factKey,
    polarity: 'statement',
    status: 'active',
    privacyClass: 'private',
    confidence: 0.95,
    importance: 0.85,
    provenance: {
      sourceSystem: 'owner_correction',
      sourceRecordId: actor,
      evidenceIds: [`owner:${actor}`],
      firstSeen: now,
      lastConfirmed: now,
      confirmations: 1,
    },
    retention: defaultRetention('long_lived', now),
    ownerTrusted: true,
    derived: false,
    memoryClass: inferMemoryClass({ kind: 'fact', factKey }),
  };
}

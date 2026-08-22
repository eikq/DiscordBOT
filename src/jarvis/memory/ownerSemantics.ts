/**
 * Owner semantic facts on the canonical SQLite store.
 * Memory is evidence, never permission.
 */

import {
  canonicalMemoryId,
  defaultRetention,
  type JarvisMemoryStore,
  type SemanticFactRecord,
} from '../../bot/memory/jarvis';
import { looksLikeSecret } from '../security/redaction';

export const OWNER_ALIAS_PREFIX = 'owner.alias.';
export const OWNER_PREF_PREFIX = 'owner.pref.';

export type OwnerAliasRecord = {
  factKey: string;
  phrase: string;
  target: string;
  kind: 'display' | 'project' | 'other';
};

export type OwnerSemanticWrite =
  | { ok: true; factKey: string; superseded?: string }
  | { ok: false; reasonCode: 'UNTRUSTED_MEMORY_WRITE' | 'SECRET_IN_MEMORY' | 'NOT_OWNER' | 'NOT_FOUND' | 'STORE_UNAVAILABLE'; message: string };

const UNTRUSTED_ACTORS = new Set(['webpage', 'research', 'document', 'tool', 'model']);

export function slugAlias(phrase: string): string {
  return phrase.toLocaleLowerCase().replace(/[^a-z0-9\u0E00-\u0E7F]+/giu, '_').replace(/^_|_$/g, '').slice(0, 48);
}

export function displayAliasKey(phrase: string): string {
  return `${OWNER_ALIAS_PREFIX}display.${slugAlias(phrase)}`;
}

export function listOwnerAliases(store: JarvisMemoryStore | undefined, kind?: OwnerAliasRecord['kind']): OwnerAliasRecord[] {
  if (!store) return [];
  const prefix = kind ? `${OWNER_ALIAS_PREFIX}${kind}.` : OWNER_ALIAS_PREFIX;
  return store.listFacts({ limit: 80 })
    .filter(item => item.status === 'active' && item.factKey.startsWith(prefix))
    .map(item => ({
      factKey: item.factKey,
      phrase: item.predicate.replace(/^alias:/, ''),
      target: item.objectValue,
      kind: item.factKey.includes('.display.') ? 'display' : item.factKey.includes('.project.') ? 'project' : 'other',
    }));
}

export function rememberOwnerAlias(
  store: JarvisMemoryStore | undefined,
  input: { phrase: string; target: string; kind: OwnerAliasRecord['kind']; actor: string; evidence?: string },
): OwnerSemanticWrite {
  const gated = gateWrite(store, input.actor, `${input.phrase} ${input.target}`);
  if (gated) return gated;
  const factKey = `${OWNER_ALIAS_PREFIX}${input.kind}.${slugAlias(input.phrase)}`;
  return upsertFact(store!, {
    factKey,
    predicate: `alias:${input.phrase.trim()}`,
    objectValue: normalizeAliasTarget(input.target),
    actor: input.actor,
    evidence: input.evidence || 'owner-utterance',
  });
}

export function forgetOwnerAlias(
  store: JarvisMemoryStore | undefined,
  phrase: string,
  actor: string,
): OwnerSemanticWrite {
  const gated = gateWrite(store, actor, phrase);
  if (gated) return gated;
  const matches = listOwnerAliases(store).filter(item => slugAlias(item.phrase) === slugAlias(phrase) || item.phrase.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()));
  if (!matches.length) return { ok: false, reasonCode: 'NOT_FOUND', message: `I do not have an alias for “${phrase}”.` };
  for (const item of matches) {
    const current = store!.listFacts({ factKey: item.factKey, limit: 1 })[0];
    if (current) store!.forget(current.id);
  }
  return { ok: true, factKey: matches[0]!.factKey };
}

export function rememberOwnerPreference(
  store: JarvisMemoryStore | undefined,
  input: { key: string; value: string; actor: string },
): OwnerSemanticWrite {
  const gated = gateWrite(store, input.actor, `${input.key}=${input.value}`);
  if (gated) return gated;
  return upsertFact(store!, {
    factKey: `${OWNER_PREF_PREFIX}${slugAlias(input.key)}`,
    predicate: input.key,
    objectValue: input.value,
    actor: input.actor,
    evidence: 'owner-utterance',
  });
}

export function resolveDisplayAlias(aliases: OwnerAliasRecord[], phrase: string | undefined): string | undefined {
  if (!phrase) return undefined;
  const slug = slugAlias(phrase);
  const lowered = phrase.toLocaleLowerCase();
  return aliases.find(item => {
    if (item.kind !== 'display') return false;
    const itemSlug = slugAlias(item.phrase);
    return itemSlug === slug
      || lowered.includes(item.phrase.toLocaleLowerCase())
      || slug.includes(itemSlug);
  })?.target;
}

export function formatAliasAnswer(aliases: OwnerAliasRecord[]): string {
  const displays = aliases.filter(item => item.kind === 'display');
  if (!displays.length) return 'I do not have any owner-taught monitor names yet.';
  return displays.map(item => `“${item.phrase}” means ${item.target}.`).join(' ');
}

export function listOwnerPreferences(store: JarvisMemoryStore | undefined): Array<{ factKey: string; key: string; value: string }> {
  if (!store) return [];
  return store.listFacts({ limit: 80 })
    .filter(item => item.status === 'active' && item.factKey.startsWith(OWNER_PREF_PREFIX))
    .map(item => ({ factKey: item.factKey, key: item.predicate, value: item.objectValue }));
}

export function formatOwnerPreferenceAnswer(store: JarvisMemoryStore | undefined, query = ''): string {
  const prefs = listOwnerPreferences(store);
  if (!prefs.length) return 'I do not have an owner reply-style preference stored yet.';
  const focused = /ตอบ|short|style|prefer|ชอบ/iu.test(query)
    ? prefs.filter(item => /style|short|ตอบ|prefer|note/iu.test(`${item.key} ${item.value}`))
    : prefs;
  const used = focused.length ? focused : prefs;
  return used.map(item => `You asked me to remember: ${item.value}`).join(' ');
}

export function normalizeAliasTarget(target: string): string {
  const trimmed = target.trim();
  if (trimmed.startsWith('display.fp:') || trimmed.startsWith('{')) return trimmed;
  if (/^\\\\\.\\DISPLAY/iu.test(trimmed) || /^display-/iu.test(trimmed)) return trimmed;
  if (/built-?in|internal|notebook|laptop|จอโน้ต|จอเครื่อง/iu.test(trimmed) && !/\d/.test(trimmed)) {
    return 'display.internal';
  }
  return trimmed;
}

function gateWrite(store: JarvisMemoryStore | undefined, actor: string, payload: string): OwnerSemanticWrite | undefined {
  if (!store) return { ok: false, reasonCode: 'STORE_UNAVAILABLE', message: 'Owner memory is not attached.' };
  if (UNTRUSTED_ACTORS.has(actor)) {
    return { ok: false, reasonCode: 'UNTRUSTED_MEMORY_WRITE', message: 'Web or tool text cannot write owner memory.' };
  }
  if (actor !== 'owner' && actor !== 'owner-ui') {
    return { ok: false, reasonCode: 'NOT_OWNER', message: 'Only a verified owner utterance can store this.' };
  }
  if (looksLikeSecret(payload)) {
    return { ok: false, reasonCode: 'SECRET_IN_MEMORY', message: 'I will not store secret-like material.' };
  }
  return undefined;
}

function upsertFact(store: JarvisMemoryStore, input: {
  factKey: string;
  predicate: string;
  objectValue: string;
  actor: string;
  evidence: string;
}): OwnerSemanticWrite {
  const existing = store.listFacts({ factKey: input.factKey, limit: 1 })[0];
  const next = factRecord(input);
  if (existing && existing.objectValue !== input.objectValue) {
    store.supersedeFact(existing.id, next);
    return { ok: true, factKey: input.factKey, superseded: existing.id };
  }
  store.putFact(next, { allowConflict: true });
  return { ok: true, factKey: input.factKey };
}

function factRecord(input: {
  factKey: string;
  predicate: string;
  objectValue: string;
  actor: string;
  evidence: string;
}): SemanticFactRecord {
  const now = Date.now();
  return {
    id: canonicalMemoryId('fact', `${input.factKey}:${now}`),
    kind: 'fact',
    predicate: input.predicate,
    objectValue: input.objectValue,
    factKey: input.factKey,
    polarity: 'statement',
    status: 'active',
    privacyClass: 'private',
    confidence: 0.95,
    importance: 0.8,
    provenance: {
      sourceSystem: input.actor,
      sourceRecordId: input.factKey,
      evidenceIds: [input.evidence],
      firstSeen: now,
      lastConfirmed: now,
      confirmations: 1,
    },
    retention: defaultRetention('long_lived', now),
  };
}

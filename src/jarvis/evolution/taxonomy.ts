import type { MemoryKind } from './types';

export const MEMORY_TAXONOMY: Record<MemoryKind, string> = {
  working: 'Short-lived turn/session context. Not durable authority.',
  episodic: 'What happened: experiences, tasks, interactions.',
  semantic: 'Durable claims about the world or owner facts.',
  procedural: 'How to do something: skills and workflows.',
  user_model: 'Owner preferences and corrections.',
  social: 'People, relationships, speaking habits.',
  self_model: 'Evidence-backed competence, not a personality score.',
};

export const CLAIM_STATUSES = [
  'OBSERVED',
  'OWNER_CONFIRMED',
  'WEB_VERIFIED',
  'INFERRED',
  'SUPERSEDED',
  'STALE',
] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const TTL_CLASSES = ['slow', 'medium', 'fast', 'very_fast'] as const;
export type TtlClass = (typeof TTL_CLASSES)[number];

export const TTL_MS: Record<TtlClass, number> = {
  slow: 180 * 24 * 60 * 60_000,
  medium: 30 * 24 * 60 * 60_000,
  fast: 7 * 24 * 60 * 60_000,
  very_fast: 24 * 60 * 60_000,
};

export function ttlClassForFactKey(factKey: string): TtlClass {
  const key = factKey.toLowerCase();
  if (/price|stock|weather|status/u.test(key)) return 'very_fast';
  if (/driver|version|firmware/u.test(key)) return 'fast';
  if (/gpu|cpu|memory_backend|hardware/u.test(key)) return 'slow';
  return 'medium';
}

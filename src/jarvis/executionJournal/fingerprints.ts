import { createHash, randomBytes } from 'node:crypto';
import { stableStringify } from '../capabilities/actions/hash';
import { looksLikeSecret, redactDeep } from '../security/redaction';
import { FORBIDDEN_JOURNAL_KEYS, JOURNAL_OPERATION_ID_PATTERN } from './types';

export function newJournalOperationId(): string {
  return `journal_${randomBytes(16).toString('hex')}`;
}

export function toJournalOperationId(raw: string): string {
  const trimmed = raw.trim();
  if (JOURNAL_OPERATION_ID_PATTERN.test(trimmed)) return trimmed.slice(0, 64);
  const sanitized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (JOURNAL_OPERATION_ID_PATTERN.test(sanitized)) return sanitized.slice(0, 64);
  return `journal_${createHash('sha256').update(trimmed || 'journal').digest('hex').slice(0, 24)}`;
}

export function fingerprintAction(capabilityId: string, action: unknown): string {
  assertPersistableJournalValue({ capabilityId, action }, 'action fingerprint');
  const canonical = canonicalPayload({ capabilityId, action: redactDeep(action) });
  return sha256(canonical);
}

export function fingerprintScope(scope: string[]): string {
  const canonical = canonicalPayload({ scope: [...new Set(scope.map(item => String(item).slice(0, 512)))].sort() });
  assertNoSecretMaterial(canonical, 'scope fingerprint');
  return sha256(canonical);
}

export function hashIdempotencyIdentity(raw: string): string {
  assertNoSecretMaterial(raw, 'idempotency identity');
  return sha256(`jarvis-journal-idempotency:${raw}`);
}

export function canonicalPayload(value: unknown): string {
  return stableStringify(redactDeep(value));
}

export function assertPersistableJournalValue(value: unknown, label: string): void {
  assertNoForbiddenKeys(value, label);
  assertNoSecretMaterial(stableStringify(value), label);
}

export function assertNoForbiddenKeys(value: unknown, label: string, depth = 0): void {
  if (depth > 8 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenKeys(item, label, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_JOURNAL_KEYS.some(forbidden => forbidden.toLowerCase() === key.toLowerCase())) {
      throw journalError('JOURNAL_SECRET_REJECTED', `${label} must not persist ${key}.`);
    }
    assertNoForbiddenKeys(item, label, depth + 1);
  }
}

export function assertNoSecretMaterial(value: string, label: string): void {
  if (looksLikeSecret(value)) {
    throw journalError('JOURNAL_SECRET_REJECTED', `${label} contains secret-like material.`);
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function journalError(reasonCode: string, message: string): Error {
  return Object.assign(new Error(message), { reasonCode });
}

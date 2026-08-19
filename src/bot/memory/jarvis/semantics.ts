import {
  CanonicalMemoryRecord,
  DeletionPolicy,
  MemoryStatus,
  PrivacyClass,
  RetentionClass,
  RetentionPolicy,
} from './types';

const RETENTION_TTL_MS: Record<RetentionClass, number | null> = {
  ephemeral: 30 * 60_000,
  session: 12 * 60 * 60_000,
  short_lived: 14 * 24 * 60 * 60_000,
  long_lived: null,
  artifact: 90 * 24 * 60 * 60_000,
  audit: null,
};

export function defaultRetention(retentionClass: RetentionClass, now = Date.now()): RetentionPolicy {
  const ttl = RETENTION_TTL_MS[retentionClass];
  const deletionPolicy: DeletionPolicy = retentionClass === 'audit' ? 'retain_audit' : 'tombstone';
  return {
    retentionClass,
    deletionPolicy,
    ...(ttl ? { expiresAt: now + ttl } : {}),
  };
}

export function isRetrievable(record: Pick<CanonicalMemoryRecord, 'status' | 'retention'>, now = Date.now()): boolean {
  if (record.status !== 'active') return false;
  if (record.retention.expiresAt && record.retention.expiresAt <= now) return false;
  return true;
}

export function canSupersede(
  previous: { factKey: string; polarity: string; status: MemoryStatus; objectValue?: string },
  next: { factKey: string; polarity: string; objectValue?: string },
): boolean {
  if (previous.status !== 'active' || previous.factKey !== next.factKey) return false;
  if (previous.polarity !== next.polarity) return true;
  if (previous.objectValue !== undefined && next.objectValue !== undefined) {
    return previous.objectValue !== next.objectValue;
  }
  return false;
}

export function applySupersession<T extends { id: string; status: MemoryStatus; confidence: number; supersededBy?: string }>(
  previous: T,
  nextId: string,
): T {
  return {
    ...previous,
    status: 'superseded',
    supersededBy: nextId,
    confidence: Math.round(previous.confidence * 0.4 * 1000) / 1000,
  };
}

export function applyForget<T extends { status: MemoryStatus; retention: RetentionPolicy }>(record: T): T {
  return {
    ...record,
    status: 'forgotten',
    retention: {
      ...record.retention,
      deletionPolicy: record.retention.deletionPolicy === 'hard_delete' ? 'hard_delete' : 'tombstone',
    },
  };
}

export function privacyRank(value: PrivacyClass): number {
  return { public: 0, private: 1, sensitive: 2, secret: 3 }[value];
}

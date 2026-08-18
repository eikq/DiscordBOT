import { CanonicalMemoryRecord, MemoryKind, QdrantMemoryPayload } from './types';
import { isCanonicalMemoryId } from './ids';

export function qdrantPayloadFor(record: CanonicalMemoryRecord, options: {
  personIds?: string[];
  source: string;
  occurredAt: number;
}): QdrantMemoryPayload {
  if (!isCanonicalMemoryId(record.id)) {
    throw new Error(`Qdrant payload requires a canonical memory id, received ${record.id}`);
  }
  return {
    memory_type: record.kind,
    canonical_id: record.id,
    person_ids: options.personIds || [],
    source: options.source,
    occurred_at: new Date(options.occurredAt).toISOString(),
    privacy: record.privacyClass,
    importance: record.importance,
    confidence: record.confidence,
    status: record.status,
  };
}

export function qdrantPointId(canonicalId: string): string {
  if (!isCanonicalMemoryId(canonicalId)) {
    throw new Error(`Qdrant point id requires a canonical memory id, received ${canonicalId}`);
  }
  return canonicalId;
}

export function assertQdrantIsIndexOnly(payload: QdrantMemoryPayload, kind: MemoryKind): void {
  if (payload.canonical_id.split(':', 1)[0] !== kind && payload.memory_type !== kind) {
    throw new Error('Qdrant payload memory_type must match the canonical id kind.');
  }
  if (payload.canonical_id !== qdrantPointId(payload.canonical_id)) {
    throw new Error('Qdrant must store the canonical id rather than minting a separate source of truth.');
  }
}

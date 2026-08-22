import type { MemoryKind, MemoryStatus, SemanticFactRecord } from '../../bot/memory/jarvis/types';
import type { JarvisMemoryStore, MemoryListFilter } from '../../bot/memory/jarvis/store';
import { compactMemoryTokens, extractFactKeys, memoryIntentFor, wantsSupersededHistory } from './intent';
import { OWNER_PREF_PREFIX } from './ownerSemantics';
import {
  DEFAULT_MEMORY_TURN_LIMIT,
  formatMemoryPromptBlock,
  type CompactMemoryItem,
  type JarvisMemoryService,
  type MemoryTurnContext,
  type MemoryTurnQuery,
} from './service';

export type MemoryRetrievalQuery = MemoryListFilter & {
  kinds?: MemoryKind[];
  canonicalId?: string;
  includeSuperseded?: boolean;
};

export type RetrievedMemory = {
  canonicalId: string;
  kind: MemoryKind;
  status: MemoryStatus;
  text: string;
  factKey?: string;
  supersededBy?: string;
  evidenceIds: string[];
  confidence: number;
};

/**
 * Core-facing retrieval over JarvisMemoryStore.
 * SQLite FTS is an optional lexical helper; Qdrant is not used.
 */
export class JarvisMemoryRetrieval implements JarvisMemoryService {
  constructor(private readonly store: JarvisMemoryStore) {}

  public retrieve(query: MemoryRetrievalQuery = {}): RetrievedMemory[] {
    const allowed = visibleStatuses(query);
    if (query.canonicalId) {
      const found = this.store.getById(query.canonicalId);
      if (!found) return [];
      const mapped = mapRecord(found.kind, found.record);
      if (!mapped) return [];
      if (query.status) {
        return allowed.includes(mapped.status) ? [mapped] : [];
      }
      if (mapped.status === 'forgotten' || mapped.status === 'expired') return [];
      return [mapped];
    }
    const kinds = query.kinds?.length ? query.kinds : query.factKey ? ['fact'] : ['fact', 'episode'];
    const results: RetrievedMemory[] = [];
    if (kinds.includes('fact')) {
      for (const fact of this.store.listFacts({ ...query, status: allowed })) {
        const mapped = mapRecord('fact', fact);
        if (mapped && allowed.includes(mapped.status)) results.push(mapped);
      }
    }
    if (kinds.includes('episode')) {
      for (const episode of this.store.listEpisodes({ ...query, status: allowed })) {
        const mapped = mapRecord('episode', episode);
        if (mapped && allowed.includes(mapped.status)) results.push(mapped);
      }
    }
    return preferActive(results).slice(0, query.limit ?? 50);
  }

  public retrieveForTurn(query: MemoryTurnQuery): MemoryTurnContext {
    try {
      return this.retrieveForTurnUnsafe(query);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        items: [],
        degraded: true,
        reason: `Memory retrieval unavailable (${detail})`,
        promptBlock: '',
      };
    }
  }

  private retrieveForTurnUnsafe(query: MemoryTurnQuery): MemoryTurnContext {
    const intent = memoryIntentFor(query.text);
    if (intent === 'skip') {
      return { items: [], degraded: false, promptBlock: '' };
    }
    const limit = clampLimit(query.limit ?? DEFAULT_MEMORY_TURN_LIMIT);
    const includeSuperseded = query.includeSuperseded ?? wantsSupersededHistory(query.text);
    const seen = new Set<string>();
    const collected: RetrievedMemory[] = [];
    const pushAll = (rows: RetrievedMemory[]) => {
      for (const row of rows) {
        if (seen.has(row.canonicalId)) continue;
        seen.add(row.canonicalId);
        collected.push(row);
      }
    };

    for (const factKey of extractFactKeys(query.text)) {
      pushAll(this.retrieve({ factKey, includeSuperseded, limit }));
    }
    if (/ชอบ|prefer|ตอบแบบ|reply.?style|how do i like/iu.test(query.text)) {
      for (const fact of this.store.listFacts({ limit: 20 })) {
        if (fact.status !== 'active' || !fact.factKey.startsWith(OWNER_PREF_PREFIX)) continue;
        const mapped = mapRecord('fact', fact);
        if (mapped) pushAll([mapped]);
      }
    }
    const tokens = compactMemoryTokens(query.text);
    if (collected.length === 0 && tokens.length > 0) {
      pushAll(this.retrieve({
        query: tokens.join(' '),
        includeSuperseded,
        kinds: ['fact', 'episode'],
        limit,
      }));
    }
    if (collected.length === 0) {
      for (const token of tokens) {
        pushAll(this.retrieve({
          query: token,
          includeSuperseded,
          kinds: ['fact', 'episode'],
          limit: 4,
        }));
        if (collected.length >= limit) break;
      }
    }

    const items = preferActive(collected).slice(0, limit).map(toCompact);
    return {
      items,
      degraded: false,
      promptBlock: formatMemoryPromptBlock(items),
    };
  }
}

function visibleStatuses(query: MemoryRetrievalQuery): MemoryStatus[] {
  if (query.status) {
    return Array.isArray(query.status) ? query.status : [query.status];
  }
  return query.includeSuperseded ? ['active', 'superseded'] : ['active'];
}

function preferActive(rows: RetrievedMemory[]): RetrievedMemory[] {
  return [...rows].sort((left, right) => Number(right.status === 'active') - Number(left.status === 'active'));
}

function clampLimit(limit: number): number {
  return Math.min(12, Math.max(1, Math.round(limit)));
}

function toCompact(row: RetrievedMemory): CompactMemoryItem {
  return {
    canonicalId: row.canonicalId,
    type: row.kind,
    status: row.status,
    text: row.text,
    factKey: row.factKey,
    confidence: row.confidence,
    sourceRefs: [...row.evidenceIds],
  };
}

function mapRecord(kind: MemoryKind, record: unknown): RetrievedMemory | null {
  if (!record || typeof record !== 'object') return null;
  const value = record as Partial<SemanticFactRecord> & {
    id?: string;
    status?: MemoryStatus;
    summary?: string;
    objectValue?: string;
    factKey?: string;
    supersededBy?: string;
    confidence?: number;
    provenance?: { evidenceIds?: string[] };
  };
  if (!value.id || !value.status) return null;
  return {
    canonicalId: value.id,
    kind,
    status: value.status,
    text: value.objectValue || value.summary || value.id,
    factKey: value.factKey,
    supersededBy: value.supersededBy,
    evidenceIds: value.provenance?.evidenceIds || [],
    confidence: value.confidence ?? 0,
  };
}

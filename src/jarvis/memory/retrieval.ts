import type { CanonicalMemoryRecord, MemoryClass, MemoryKind, MemoryStatus, SemanticFactRecord } from '../../bot/memory/jarvis/types';
import type { JarvisMemoryStore, MemoryListFilter } from '../../bot/memory/jarvis/store';
import { fuseMemoryRetrieval, type SemanticHit } from './fusionRetrieval';
import { compactMemoryTokens, extractFactKeys, memoryIntentFor, wantsSupersededHistory } from './intent';
import { applyOwnerCorrection } from './ownerCorrection';
import { classesForRequest, memoryRequestClass } from './queryClass';
import { scoreMemoryItem } from './scoring';
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
  importance?: number;
  memoryClass?: MemoryClass;
  ownerTrusted?: boolean;
  derived?: boolean;
  sourceSystem?: string;
  lastConfirmed?: number;
  createdAt?: number;
  updatedAt?: number;
  supersedes?: string;
};

/**
 * Core-facing retrieval over JarvisMemoryStore.
 * SQLite FTS is an optional lexical helper; Qdrant is a derived index only.
 */
export class JarvisMemoryRetrieval implements JarvisMemoryService {
  constructor(private readonly store: JarvisMemoryStore) {}

  public applyOwnerCorrection(text: string) {
    return applyOwnerCorrection(this.store, text);
  }

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
    if (typeof this.store.expireDue === 'function') {
      this.store.expireDue(query.now);
    }
    const intent = memoryIntentFor(query.text);
    if (intent === 'skip') {
      return { items: [], degraded: false, promptBlock: '' };
    }
    const limit = clampLimit(query.limit ?? DEFAULT_MEMORY_TURN_LIMIT);
    const includeSuperseded = query.includeSuperseded ?? wantsSupersededHistory(query.text);
    const requestClass = memoryRequestClass(query.text);
    const allowedClasses = classesForRequest(requestClass);
    const now = query.now ?? Date.now();
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
    const tokens = compactMemoryTokens(query.text);
    if (collected.length === 0 && tokens.length > 0) {
      pushAll(this.retrieve({
        query: tokens.join(' '),
        includeSuperseded,
        kinds: ['fact', 'episode'],
        limit: Math.max(limit, 12),
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
        if (collected.length >= limit * 2) break;
      }
    }
    if (requestClass === 'conversation') {
      pushAll(this.retrieve({ kinds: ['fact'], memoryClass: ['identity', 'social'], includeSuperseded: false, limit: 4 }));
      pushAll(this.retrieve({ kinds: ['episode'], memoryClass: 'episodic', includeSuperseded: false, limit: 3 }));
    }

    const canonicalById = new Map(collected.map(item => [item.canonicalId, item]));
    for (const hit of query.semanticHits ?? []) {
      if (!hit.canonicalId || canonicalById.has(hit.canonicalId)) continue;
      const found = this.store.getById(hit.canonicalId);
      const mapped = found ? mapRecord(found.kind, found.record) : null;
      if (mapped && mapped.status !== 'forgotten' && mapped.status !== 'expired') {
        canonicalById.set(mapped.canonicalId, mapped);
      }
    }

    const fused = fuseMemoryRetrieval({
      lexical: collected,
      semantic: query.semanticHits as SemanticHit[] | undefined,
      canonicalById,
      topK: Math.max(limit * 2, 8),
    });
    const fusedRows = fused.items
      .map(item => canonicalById.get(item.canonicalId))
      .filter((item): item is RetrievedMemory => Boolean(item));

    const scored = fusedRows.map((row, index) => {
      const semanticHit = (query.semanticHits ?? []).find(hit => hit.canonicalId === row.canonicalId);
      const lexicalRank = collected.findIndex(item => item.canonicalId === row.canonicalId);
      const scores = scoreMemoryItem({
        lexicalRank: lexicalRank >= 0 ? lexicalRank : undefined,
        semanticScore: semanticHit?.score,
        lastConfirmed: row.lastConfirmed ?? now,
        now,
        importance: row.importance ?? 0.5,
        status: row.status,
        memoryClass: row.memoryClass,
        allowedClasses,
      });
      return { row, scores, index };
    }).sort((left, right) => right.scores.total - left.scores.total || left.index - right.index);

    const classFiltered = intent === 'fact-key' || includeSuperseded
      ? scored
      : scored.filter(item => item.scores.classRelevance >= 0.5);
    const selected = (classFiltered.length > 0 ? classFiltered : scored).slice(0, limit);
    const items = selected.map(item => toCompact(item.row, item.scores));
    return {
      items,
      degraded: false,
      promptBlock: formatMemoryPromptBlock(items),
      requestClass,
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

function toCompact(row: RetrievedMemory, scores: CompactMemoryItem['retrievalScores']): CompactMemoryItem {
  return {
    canonicalId: row.canonicalId,
    type: row.kind,
    status: row.status,
    text: row.text,
    factKey: row.factKey,
    confidence: row.confidence,
    sourceRefs: [...row.evidenceIds],
    memoryClass: row.memoryClass,
    ownerTrusted: row.ownerTrusted,
    derived: row.derived,
    sourceSystem: row.sourceSystem,
    retrievalScores: scores,
  };
}

function mapRecord(kind: MemoryKind, record: unknown): RetrievedMemory | null {
  if (!record || typeof record !== 'object') return null;
  const value = record as Partial<SemanticFactRecord> & Partial<CanonicalMemoryRecord> & {
    id?: string;
    status?: MemoryStatus;
    summary?: string;
    objectValue?: string;
    factKey?: string;
    supersededBy?: string;
    confidence?: number;
    importance?: number;
    provenance?: { evidenceIds?: string[]; sourceSystem?: string; lastConfirmed?: number };
  };
  if (!value.id || !value.status) return null;
  return {
    canonicalId: value.id,
    kind,
    status: value.status,
    text: value.objectValue || value.summary || value.id,
    factKey: value.factKey,
    supersededBy: value.supersededBy,
    evidenceIds: value.provenance?.evidenceIds || value.memoryRefs || [],
    confidence: value.confidence ?? 0,
    importance: value.importance,
    memoryClass: value.memoryClass,
    ownerTrusted: value.ownerTrusted,
    derived: value.derived,
    sourceSystem: value.provenance?.sourceSystem,
    lastConfirmed: value.provenance?.lastConfirmed ?? value.updatedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    supersedes: value.supersedes,
  };
}

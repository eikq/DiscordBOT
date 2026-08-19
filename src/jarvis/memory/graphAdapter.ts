import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { defaultJarvisDbPath } from '../../bot/memory/jarvis/migrate';
import type { MemoryStatus, PrivacyClass } from '../../bot/memory/jarvis/types';

/**
 * Read-only knowledge-graph view over the Jarvis memory SQLite store.
 * This is a lab/UI adapter: it never writes, never migrates, and never
 * fabricates nodes or relationships that are not present in the database.
 */

export type MemoryGraphNodeKind = 'entity' | 'fact' | 'episode' | 'observation' | 'artifact';

export type MemoryGraphNode = {
  id: string;
  kind: MemoryGraphNodeKind;
  /** entity subtype (person/project/…) for entities, kind for the rest */
  category: string;
  label: string;
  status: MemoryStatus;
  confidence: number;
  importance: number;
  privacyClass: PrivacyClass;
  firstSeen?: number;
  lastConfirmed?: number;
  degree: number;
};

export type MemoryGraphEdgeKind = 'fact-subject' | 'relationship' | 'link' | 'evidence';

export type MemoryGraphEdge = {
  id: string;
  source: string;
  target: string;
  relation: string;
  kind: MemoryGraphEdgeKind;
};

export type MemoryGraphSnapshot = {
  attached: boolean;
  reason?: string;
  generatedAt: number;
  dbPath?: string;
  counts: {
    entities: number;
    facts: number;
    episodes: number;
    observations: number;
    relationships: number;
    links: number;
  };
  truncated: boolean;
  nodes: MemoryGraphNode[];
  edges: MemoryGraphEdge[];
};

export type MemoryNodeDetail = {
  found: boolean;
  id: string;
  kind?: string;
  status?: string;
  confidence?: number;
  importance?: number;
  privacyClass?: string;
  label?: string;
  factKey?: string;
  predicate?: string;
  objectValue?: string;
  summary?: string;
  entityType?: string;
  displayName?: string;
  occurredAt?: number;
  firstSeen?: number;
  lastConfirmed?: number;
  supersededBy?: string;
  provenance?: {
    sourceSystem?: string;
    sourceRecordId?: string;
    confirmations?: number;
    evidenceIds: string[];
  };
  aliases?: string[];
  relations: Array<{ id: string; relation: string; otherId: string; direction: 'out' | 'in' }>;
};

const GRAPH_LIMITS = {
  entities: 300,
  facts: 500,
  episodes: 250,
  observations: 250,
  relationships: 400,
  links: 600,
} as const;

function labelFor(privacyClass: string, text: string, id: string): string {
  if (privacyClass === 'secret') return id;
  const clean = String(text || '').trim() || id;
  return clean.length > 64 ? `${clean.slice(0, 62)}…` : clean;
}

function parseEvidence(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(item => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export class MemoryGraphAdapter {
  private readonly db: DatabaseSync;
  public readonly dbPath: string;

  constructor(dbPath = defaultJarvisDbPath()) {
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Memory store not found at ${dbPath}.`);
    }
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath, { readOnly: true });
  }

  public close(): void {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }

  public snapshot(): MemoryGraphSnapshot {
    const generatedAt = Date.now();
    const nodes = new Map<string, MemoryGraphNode>();
    const edges: MemoryGraphEdge[] = [];

    const entities = this.db.prepare(`
      SELECT id, entity_type, display_name, status, confidence, importance, privacy_class, first_seen, last_confirmed
      FROM entities WHERE status IN ('active','superseded')
      ORDER BY last_confirmed DESC LIMIT ?
    `).all(GRAPH_LIMITS.entities);
    for (const row of entities) {
      nodes.set(String(row.id), {
        id: String(row.id),
        kind: 'entity',
        category: String(row.entity_type || 'other'),
        label: labelFor(String(row.privacy_class), String(row.display_name), String(row.id)),
        status: (row.status as MemoryStatus) || 'active',
        confidence: Number(row.confidence ?? 1),
        importance: Number(row.importance ?? 0.7),
        privacyClass: (row.privacy_class as PrivacyClass) || 'private',
        firstSeen: row.first_seen == null ? undefined : Number(row.first_seen),
        lastConfirmed: row.last_confirmed == null ? undefined : Number(row.last_confirmed),
        degree: 0,
      });
    }

    const facts = this.db.prepare(`
      SELECT id, subject_entity_id, predicate, object_value, fact_key, status, confidence, importance,
             privacy_class, first_seen, last_confirmed, evidence_json
      FROM facts WHERE status IN ('active','superseded')
      ORDER BY last_confirmed DESC LIMIT ?
    `).all(GRAPH_LIMITS.facts);
    const evidenceWanted = new Set<string>();
    for (const row of facts) {
      const id = String(row.id);
      nodes.set(id, {
        id,
        kind: 'fact',
        category: 'fact',
        label: labelFor(String(row.privacy_class), `${row.fact_key}`, id),
        status: (row.status as MemoryStatus) || 'active',
        confidence: Number(row.confidence ?? 0.5),
        importance: Number(row.importance ?? 0.5),
        privacyClass: (row.privacy_class as PrivacyClass) || 'private',
        firstSeen: row.first_seen == null ? undefined : Number(row.first_seen),
        lastConfirmed: row.last_confirmed == null ? undefined : Number(row.last_confirmed),
        degree: 0,
      });
      for (const evidenceId of parseEvidence(row.evidence_json)) evidenceWanted.add(evidenceId);
    }

    const episodes = this.db.prepare(`
      SELECT id, occurred_at, summary, event_type, status, confidence, importance, privacy_class
      FROM episodes WHERE status IN ('active','superseded')
      ORDER BY occurred_at DESC LIMIT ?
    `).all(GRAPH_LIMITS.episodes);
    for (const row of episodes) {
      const id = String(row.id);
      nodes.set(id, {
        id,
        kind: 'episode',
        category: 'episode',
        label: labelFor(String(row.privacy_class), String(row.summary), id),
        status: (row.status as MemoryStatus) || 'active',
        confidence: Number(row.confidence ?? 0.5),
        importance: Number(row.importance ?? 0.5),
        privacyClass: (row.privacy_class as PrivacyClass) || 'private',
        firstSeen: row.occurred_at == null ? undefined : Number(row.occurred_at),
        lastConfirmed: row.occurred_at == null ? undefined : Number(row.occurred_at),
        degree: 0,
      });
    }

    // Observations only when actually referenced as evidence by an included fact.
    let observationCount = 0;
    if (evidenceWanted.size > 0) {
      const wanted = [...evidenceWanted].slice(0, GRAPH_LIMITS.observations);
      const rows = this.db.prepare(`
        SELECT id, occurred_at, event_type, text, status, confidence, importance, privacy_class
        FROM observations WHERE id IN (${wanted.map(() => '?').join(',')})
      `).all(...wanted);
      for (const row of rows) {
        const id = String(row.id);
        observationCount += 1;
        nodes.set(id, {
          id,
          kind: 'observation',
          category: 'observation',
          label: labelFor(String(row.privacy_class), String(row.text || row.event_type), id),
          status: (row.status as MemoryStatus) || 'active',
          confidence: Number(row.confidence ?? 0.5),
          importance: Number(row.importance ?? 0.4),
          privacyClass: (row.privacy_class as PrivacyClass) || 'private',
          firstSeen: row.occurred_at == null ? undefined : Number(row.occurred_at),
          lastConfirmed: row.occurred_at == null ? undefined : Number(row.occurred_at),
          degree: 0,
        });
      }
    }

    const pushEdge = (edge: MemoryGraphEdge) => {
      if (!nodes.has(edge.source) || !nodes.has(edge.target)) return;
      edges.push(edge);
    };

    for (const row of facts) {
      const subject = row.subject_entity_id == null ? '' : String(row.subject_entity_id);
      if (subject) {
        pushEdge({
          id: `fs:${row.id}`,
          source: subject,
          target: String(row.id),
          relation: String(row.predicate || 'subject'),
          kind: 'fact-subject',
        });
      }
      for (const evidenceId of parseEvidence(row.evidence_json)) {
        pushEdge({
          id: `ev:${row.id}:${evidenceId}`,
          source: String(row.id),
          target: evidenceId,
          relation: 'evidence',
          kind: 'evidence',
        });
      }
    }

    const relationships = this.db.prepare(`
      SELECT id, left_entity_id, right_entity_id, interaction_count, status
      FROM relationships WHERE status IN ('active','superseded')
      ORDER BY updated_at DESC LIMIT ?
    `).all(GRAPH_LIMITS.relationships);
    for (const row of relationships) {
      pushEdge({
        id: String(row.id),
        source: String(row.left_entity_id),
        target: String(row.right_entity_id),
        relation: `relationship ×${Number(row.interaction_count || 1)}`,
        kind: 'relationship',
      });
    }

    const links = this.db.prepare(
      'SELECT id, from_id, to_id, relation FROM memory_links ORDER BY created_at DESC LIMIT ?',
    ).all(GRAPH_LIMITS.links);
    for (const row of links) {
      pushEdge({
        id: String(row.id),
        source: String(row.from_id),
        target: String(row.to_id),
        relation: String(row.relation || 'link'),
        kind: 'link',
      });
    }

    for (const edge of edges) {
      const source = nodes.get(edge.source);
      const target = nodes.get(edge.target);
      if (source) source.degree += 1;
      if (target) target.degree += 1;
    }

    return {
      attached: true,
      generatedAt,
      dbPath: this.dbPath,
      counts: {
        entities: entities.length,
        facts: facts.length,
        episodes: episodes.length,
        observations: observationCount,
        relationships: relationships.length,
        links: links.length,
      },
      truncated: entities.length >= GRAPH_LIMITS.entities
        || facts.length >= GRAPH_LIMITS.facts
        || episodes.length >= GRAPH_LIMITS.episodes
        || links.length >= GRAPH_LIMITS.links,
      nodes: [...nodes.values()],
      edges,
    };
  }

  public nodeDetail(id: string): MemoryNodeDetail {
    const clean = String(id || '').trim();
    const base: MemoryNodeDetail = { found: false, id: clean, relations: [] };
    if (!clean) return base;

    const relations: MemoryNodeDetail['relations'] = [];
    for (const row of this.db.prepare(
      'SELECT id, from_id, to_id, relation FROM memory_links WHERE from_id = ? OR to_id = ? LIMIT 60',
    ).all(clean, clean)) {
      const out = String(row.from_id) === clean;
      relations.push({
        id: String(row.id),
        relation: String(row.relation),
        otherId: out ? String(row.to_id) : String(row.from_id),
        direction: out ? 'out' : 'in',
      });
    }
    for (const row of this.db.prepare(
      'SELECT id, left_entity_id, right_entity_id, interaction_count FROM relationships WHERE left_entity_id = ? OR right_entity_id = ? LIMIT 60',
    ).all(clean, clean)) {
      const out = String(row.left_entity_id) === clean;
      relations.push({
        id: String(row.id),
        relation: `relationship ×${Number(row.interaction_count || 1)}`,
        otherId: out ? String(row.right_entity_id) : String(row.left_entity_id),
        direction: out ? 'out' : 'in',
      });
    }

    const entity = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(clean);
    if (entity) {
      const aliases = this.db.prepare('SELECT alias FROM aliases WHERE entity_id = ? ORDER BY alias LIMIT 24')
        .all(clean).map(row => String(row.alias));
      for (const row of this.db.prepare(
        'SELECT id, predicate, fact_key FROM facts WHERE subject_entity_id = ? LIMIT 60',
      ).all(clean)) {
        relations.push({ id: `fs:${row.id}`, relation: String(row.predicate || 'subject'), otherId: String(row.id), direction: 'out' });
      }
      return {
        ...base,
        found: true,
        kind: 'entity',
        entityType: String(entity.entity_type || 'other'),
        displayName: String(entity.display_name),
        label: labelFor(String(entity.privacy_class), String(entity.display_name), clean),
        status: String(entity.status || 'active'),
        confidence: Number(entity.confidence ?? 1),
        importance: Number(entity.importance ?? 0.7),
        privacyClass: String(entity.privacy_class || 'private'),
        firstSeen: entity.first_seen == null ? undefined : Number(entity.first_seen),
        lastConfirmed: entity.last_confirmed == null ? undefined : Number(entity.last_confirmed),
        supersededBy: entity.superseded_by == null ? undefined : String(entity.superseded_by),
        provenance: {
          sourceSystem: entity.source_system == null ? undefined : String(entity.source_system),
          sourceRecordId: entity.source_record_id == null ? undefined : String(entity.source_record_id),
          confirmations: Number(entity.confirmations ?? 1),
          evidenceIds: parseEvidence(entity.evidence_json),
        },
        aliases,
        relations,
      };
    }

    const fact = this.db.prepare('SELECT * FROM facts WHERE id = ?').get(clean);
    if (fact) {
      const secret = String(fact.privacy_class) === 'secret';
      if (fact.subject_entity_id != null) {
        relations.push({ id: `fs:${clean}`, relation: String(fact.predicate || 'subject'), otherId: String(fact.subject_entity_id), direction: 'in' });
      }
      return {
        ...base,
        found: true,
        kind: 'fact',
        factKey: String(fact.fact_key),
        predicate: String(fact.predicate),
        objectValue: secret ? '[secret]' : String(fact.object_value),
        label: labelFor(String(fact.privacy_class), String(fact.fact_key), clean),
        status: String(fact.status || 'active'),
        confidence: Number(fact.confidence ?? 0.5),
        importance: Number(fact.importance ?? 0.5),
        privacyClass: String(fact.privacy_class || 'private'),
        firstSeen: fact.first_seen == null ? undefined : Number(fact.first_seen),
        lastConfirmed: fact.last_confirmed == null ? undefined : Number(fact.last_confirmed),
        supersededBy: fact.superseded_by == null ? undefined : String(fact.superseded_by),
        provenance: {
          sourceSystem: fact.source_system == null ? undefined : String(fact.source_system),
          sourceRecordId: fact.source_record_id == null ? undefined : String(fact.source_record_id),
          confirmations: Number(fact.confirmations ?? 1),
          evidenceIds: parseEvidence(fact.evidence_json),
        },
        relations,
      };
    }

    const episode = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(clean);
    if (episode) {
      return {
        ...base,
        found: true,
        kind: 'episode',
        summary: String(episode.summary),
        label: labelFor(String(episode.privacy_class), String(episode.summary), clean),
        status: String(episode.status || 'active'),
        confidence: Number(episode.confidence ?? 0.5),
        importance: Number(episode.importance ?? 0.5),
        privacyClass: String(episode.privacy_class || 'private'),
        occurredAt: episode.occurred_at == null ? undefined : Number(episode.occurred_at),
        supersededBy: episode.superseded_by == null ? undefined : String(episode.superseded_by),
        provenance: {
          sourceSystem: episode.source_system == null ? undefined : String(episode.source_system),
          sourceRecordId: episode.source_record_id == null ? undefined : String(episode.source_record_id),
          confirmations: 1,
          evidenceIds: [],
        },
        relations,
      };
    }

    const observation = this.db.prepare('SELECT * FROM observations WHERE id = ?').get(clean);
    if (observation) {
      return {
        ...base,
        found: true,
        kind: 'observation',
        summary: observation.text == null ? String(observation.event_type) : String(observation.text),
        label: labelFor(String(observation.privacy_class), String(observation.text || observation.event_type), clean),
        status: String(observation.status || 'active'),
        confidence: Number(observation.confidence ?? 0.5),
        importance: Number(observation.importance ?? 0.4),
        privacyClass: String(observation.privacy_class || 'private'),
        occurredAt: observation.occurred_at == null ? undefined : Number(observation.occurred_at),
        provenance: {
          sourceSystem: observation.source_system == null ? undefined : String(observation.source_system),
          sourceRecordId: observation.source_record_id == null ? undefined : String(observation.source_record_id),
          confirmations: 1,
          evidenceIds: parseEvidence(observation.evidence_json),
        },
        relations,
      };
    }

    return { ...base, relations };
  }
}

export function emptyMemoryGraph(reason: string): MemoryGraphSnapshot {
  return {
    attached: false,
    reason,
    generatedAt: Date.now(),
    counts: { entities: 0, facts: 0, episodes: 0, observations: 0, relationships: 0, links: 0 },
    truncated: false,
    nodes: [],
    edges: [],
  };
}

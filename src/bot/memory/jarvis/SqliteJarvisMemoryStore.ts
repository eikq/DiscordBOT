import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ConversationHistoryStore } from './conversationStore';
import { canonicalMemoryId, isCanonicalMemoryId, parseCanonicalMemoryId } from './ids';
import { currentSchemaVersion, defaultJarvisDbPath, openMigratedDatabase } from './migrate';
import { applyForget, applySupersession, canSupersede, defaultRetention } from './semantics';
import type { JarvisMemoryStore, MemoryListFilter } from './store';
import {
  AliasRecord,
  ArtifactRecord,
  EntityRecord,
  EpisodeRecord,
  IdentitySettingRecord,
  MemoryConflictError,
  MemoryFeedbackRecord,
  MemoryKind,
  MemoryLinkRecord,
  MemoryStatus,
  ObservationRecord,
  PrivacyClass,
  RelationshipRecord,
  RetentionClass,
  SemanticFactRecord,
} from './types';

const FORBIDDEN_ARTIFACT = /\.(wav|pth|pt|onnx|bin|mp4|mkv)$/iu;
const SECRET_NAME = /(?:\.env|token|secret|api[_-]?key|credentials)/iu;

export class SqliteJarvisMemoryStore implements JarvisMemoryStore {
  public readonly dbPath: string;
  public readonly history: ConversationHistoryStore;
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
    this.db = openMigratedDatabase(this.dbPath);
    this.history = new ConversationHistoryStore(this.db);
    this.history.markAbandonedStarted();
  }

  public database(): DatabaseSync {
    return this.db;
  }

  public static open(dbPath = defaultJarvisDbPath()): SqliteJarvisMemoryStore {
    return new SqliteJarvisMemoryStore(dbPath);
  }

  public schemaVersion(): number {
    return currentSchemaVersion(this.db);
  }

  public close(): void {
    this.db.close();
  }

  public putEntity(record: EntityRecord): EntityRecord {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO entities (
        id, entity_type, display_name, discord_user_id, privacy_class, created_at, updated_at,
        source_system, source_record_id, status, confidence, importance, superseded_by,
        retention_class, expires_at, deletion_policy, evidence_json, confirmations, first_seen, last_confirmed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        discord_user_id = excluded.discord_user_id,
        privacy_class = excluded.privacy_class,
        updated_at = excluded.updated_at,
        confidence = excluded.confidence,
        importance = excluded.importance,
        last_confirmed = excluded.last_confirmed,
        confirmations = excluded.confirmations,
        evidence_json = excluded.evidence_json
    `).run(
      record.id,
      record.entityType,
      record.displayName,
      record.discordUserId ?? null,
      record.privacyClass,
      record.provenance.firstSeen,
      now,
      record.provenance.sourceSystem,
      record.provenance.sourceRecordId ?? null,
      record.status,
      record.confidence,
      record.importance,
      record.supersededBy ?? null,
      record.retention.retentionClass,
      record.retention.expiresAt ?? null,
      record.retention.deletionPolicy,
      json(record.provenance.evidenceIds),
      record.provenance.confirmations,
      record.provenance.firstSeen,
      record.provenance.lastConfirmed,
    );
    return this.getEntity(record.id)!;
  }

  public getEntity(id: string): EntityRecord | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
    return row ? mapEntity(row) : null;
  }

  public putAlias(entityId: string, alias: string, confidence = 1, evidenceIds: string[] = []): AliasRecord {
    const clean = alias.trim();
    if (!clean) throw new Error('Alias text is required.');
    const existing = this.db.prepare(
      'SELECT * FROM aliases WHERE entity_id = ? AND alias = ? COLLATE NOCASE',
    ).get(entityId, clean);
    if (existing) {
      this.db.prepare(
        'UPDATE aliases SET confidence = MAX(confidence, ?), evidence_json = ? WHERE id = ?',
      ).run(confidence, json(unique([...parseJsonArray(existing.evidence_json), ...evidenceIds])), existing.id);
      return mapAlias(this.db.prepare('SELECT * FROM aliases WHERE id = ?').get(existing.id)!);
    }
    const id = canonicalMemoryId('alias', `${parseCanonicalMemoryId(entityId).localId}:${clean}`);
    this.db.prepare(`
      INSERT INTO aliases (id, entity_id, alias, confidence, evidence_json, created_at, status, source_system)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 'jarvis_memory')
    `).run(id, entityId, clean, confidence, json(evidenceIds), Date.now());
    return mapAlias(this.db.prepare('SELECT * FROM aliases WHERE id = ?').get(id)!);
  }

  public listAliases(entityId: string): AliasRecord[] {
    return this.db.prepare('SELECT * FROM aliases WHERE entity_id = ? ORDER BY alias').all(entityId).map(mapAlias);
  }

  public putRelationship(record: RelationshipRecord): RelationshipRecord {
    const [left, right] = [record.leftEntityId, record.rightEntityId].sort();
    const id = left === record.leftEntityId && right === record.rightEntityId
      ? record.id
      : canonicalMemoryId('relationship', `${parseCanonicalMemoryId(left).localId}:${parseCanonicalMemoryId(right).localId}`);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO relationships (
        id, left_entity_id, right_entity_id, interaction_count, last_interaction_at, address_terms_json,
        evidence_json, privacy_class, status, confidence, importance, source_system, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        interaction_count = excluded.interaction_count,
        last_interaction_at = excluded.last_interaction_at,
        address_terms_json = excluded.address_terms_json,
        evidence_json = excluded.evidence_json,
        updated_at = excluded.updated_at
    `).run(
      id, left, right, record.interactionCount, record.lastInteractionAt ?? null,
      json(record.addressTerms), json(record.provenance.evidenceIds), record.privacyClass,
      record.status, record.confidence, record.importance, record.provenance.sourceSystem,
      record.provenance.firstSeen || now, now,
    );
    return this.getRelationship(id)!;
  }

  public getRelationship(id: string): RelationshipRecord | null {
    const row = this.db.prepare('SELECT * FROM relationships WHERE id = ?').get(id);
    return row ? mapRelationship(row) : null;
  }

  public putObservation(record: ObservationRecord): ObservationRecord {
    this.db.prepare(`
      INSERT INTO observations (
        id, occurred_at, source, actor_entity_id, event_type, text, payload_json, confidence,
        privacy_class, guild_id, session_id, source_system, source_record_id, status, importance,
        retention_class, expires_at, deletion_policy, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        text = excluded.text,
        payload_json = excluded.payload_json,
        confidence = excluded.confidence,
        evidence_json = excluded.evidence_json
    `).run(
      record.id, record.occurredAt, record.source, record.actorEntityId ?? null, record.eventType,
      record.text ?? null, json(record.payload), record.confidence, record.privacyClass,
      record.guildId ?? null, record.sessionId ?? null, record.provenance.sourceSystem,
      record.provenance.sourceRecordId ?? null, record.status, record.importance,
      record.retention.retentionClass, record.retention.expiresAt ?? null,
      record.retention.deletionPolicy, json(record.provenance.evidenceIds),
    );
    return this.getObservation(record.id)!;
  }

  public getObservation(id: string): ObservationRecord | null {
    const row = this.db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
    return row ? mapObservation(row) : null;
  }

  public putFact(record: SemanticFactRecord, options: { allowConflict?: boolean } = {}): SemanticFactRecord {
    const existing = this.getFact(record.id);
    if (existing) {
      if (existing.objectValue === record.objectValue && existing.polarity === record.polarity) {
        return this.bumpFact(existing, record);
      }
      if (existing.status === 'active' && !options.allowConflict) {
        throw new MemoryConflictError(existing.id, existing.factKey);
      }
    }
    if (record.status === 'active') {
      const conflict = this.listFacts({ factKey: record.factKey, status: 'active' })
        .find(fact => fact.id !== record.id && canSupersede(fact, record));
      if (conflict && !options.allowConflict) {
        throw new MemoryConflictError(conflict.id, record.factKey);
      }
      const same = this.listFacts({ factKey: record.factKey, status: 'active' })
        .find(fact => fact.id !== record.id && fact.objectValue === record.objectValue && fact.polarity === record.polarity);
      if (same) return this.bumpFact(same, record);
    }
    this.insertFact(record);
    return this.getFact(record.id)!;
  }

  public getFact(id: string): SemanticFactRecord | null {
    const row = this.db.prepare('SELECT * FROM facts WHERE id = ?').get(id);
    return row ? mapFact(row) : null;
  }

  public listFacts(filter: MemoryListFilter = {}): SemanticFactRecord[] {
    const statuses = asStatuses(filter.status);
    const params: Array<string | number | null> = [];
    const clauses = ['1 = 1'];
    if (filter.factKey) {
      clauses.push('fact_key = ?');
      params.push(filter.factKey);
    }
    if (statuses) {
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    let ids: string[] | undefined;
    if (filter.query?.trim()) {
      ids = this.searchFactIds(filter.query.trim());
      if (ids.length === 0) return [];
      clauses.push(`id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }
    const limit = filter.limit ?? 50;
    params.push(limit);
    return this.db.prepare(
      `SELECT * FROM facts WHERE ${clauses.join(' AND ')} ORDER BY last_confirmed DESC LIMIT ?`,
    ).all(...params).map(mapFact);
  }

  public supersedeFact(previousId: string, next: SemanticFactRecord): { previous: SemanticFactRecord; next: SemanticFactRecord } {
    const previous = this.getFact(previousId);
    if (!previous) throw new Error(`Fact ${previousId} does not exist.`);
    if (previous.status !== 'active') throw new Error(`Fact ${previousId} is ${previous.status} and cannot be superseded.`);
    if (previous.factKey !== next.factKey) throw new Error('Supersession requires the same fact key.');
    if (!canSupersede(previous, next) && previous.objectValue === next.objectValue && previous.polarity === next.polarity) {
      throw new Error('Refusing to supersede a fact with an identical value.');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.insertFact({ ...next, status: 'active' });
      const marked = applySupersession(previous, next.id);
      this.db.prepare(
        'UPDATE facts SET status = ?, superseded_by = ?, confidence = ? WHERE id = ?',
      ).run(marked.status, marked.supersededBy ?? next.id, marked.confidence, previous.id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { previous: this.getFact(previous.id)!, next: this.getFact(next.id)! };
  }

  public putEpisode(record: EpisodeRecord): EpisodeRecord {
    this.db.prepare(`
      INSERT INTO episodes (
        id, occurred_at, source, summary, event_type, payload_json, confidence, importance,
        privacy_class, status, superseded_by, expires_at, retention_class, deletion_policy,
        source_system, source_record_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        summary = excluded.summary,
        payload_json = excluded.payload_json,
        confidence = excluded.confidence,
        importance = excluded.importance
    `).run(
      record.id, record.occurredAt, record.source, record.summary, record.eventType, json(record.payload),
      record.confidence, record.importance, record.privacyClass, record.status, record.supersededBy ?? null,
      record.retention.expiresAt ?? null, record.retention.retentionClass, record.retention.deletionPolicy,
      record.provenance.sourceSystem, record.provenance.sourceRecordId ?? null,
    );
    return this.getEpisode(record.id)!;
  }

  public getEpisode(id: string): EpisodeRecord | null {
    const row = this.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id);
    return row ? mapEpisode(row) : null;
  }

  public listEpisodes(filter: MemoryListFilter = {}): EpisodeRecord[] {
    const statuses = asStatuses(filter.status);
    const params: Array<string | number | null> = [];
    const clauses = ['1 = 1'];
    if (statuses) {
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      params.push(...statuses);
    }
    if (filter.query?.trim()) {
      const ids = this.searchEpisodeIds(filter.query.trim());
      if (ids.length === 0) return [];
      clauses.push(`id IN (${ids.map(() => '?').join(', ')})`);
      params.push(...ids);
    }
    const limit = filter.limit ?? 50;
    params.push(limit);
    return this.db.prepare(
      `SELECT * FROM episodes WHERE ${clauses.join(' AND ')} ORDER BY occurred_at DESC LIMIT ?`,
    ).all(...params).map(mapEpisode);
  }

  public putArtifact(record: ArtifactRecord): ArtifactRecord {
    assertSafeArtifactPath(record.localPath);
    this.db.prepare(`
      INSERT INTO artifacts (
        id, kind, local_path, sha256, privacy_class, retention_class, expires_at, created_at,
        source_system, source_record_id, status, evidence_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        local_path = excluded.local_path,
        sha256 = excluded.sha256
    `).run(
      record.id, record.artifactKind, record.localPath, record.sha256 ?? null, record.privacyClass,
      record.retention.retentionClass, record.retention.expiresAt ?? null, record.provenance.firstSeen,
      record.provenance.sourceSystem, record.provenance.sourceRecordId ?? null, record.status,
      json(record.provenance.evidenceIds),
    );
    return this.getArtifact(record.id)!;
  }

  public getArtifact(id: string): ArtifactRecord | null {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id);
    return row ? mapArtifact(row) : null;
  }

  public putIdentitySetting(key: string, value: unknown, sourceSystem: string): IdentitySettingRecord {
    const id = canonicalMemoryId('identity', key);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO identity_settings (id, setting_key, setting_value_json, updated_at, source_system, status, privacy_class)
      VALUES (?, ?, ?, ?, ?, 'active', 'private')
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value_json = excluded.setting_value_json,
        updated_at = excluded.updated_at,
        source_system = excluded.source_system
    `).run(id, key, json(value), now, sourceSystem);
    return this.getIdentitySetting(key)!;
  }

  public getIdentitySetting(key: string): IdentitySettingRecord | null {
    const row = this.db.prepare('SELECT * FROM identity_settings WHERE setting_key = ?').get(key);
    return row ? mapIdentity(row) : null;
  }

  public putFeedback(
    targetId: string,
    action: MemoryFeedbackRecord['action'],
    note?: string,
    actor = 'owner',
  ): MemoryFeedbackRecord {
    const createdAt = Date.now();
    const id = canonicalMemoryId('feedback', `${targetId}:${createdAt}`);
    this.db.prepare(`
      INSERT INTO memory_feedback (id, target_id, action, note, created_at, actor)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, targetId, action, note ?? null, createdAt, actor);
    const row = this.db.prepare('SELECT * FROM memory_feedback WHERE id = ?').get(id)!;
    return {
      id: String(row.id),
      targetId: String(row.target_id),
      action: row.action as MemoryFeedbackRecord['action'],
      note: row.note == null ? undefined : String(row.note),
      createdAt: Number(row.created_at),
      actor: String(row.actor),
    };
  }

  public link(fromId: string, toId: string, relation: string): MemoryLinkRecord {
    const existing = this.db.prepare(
      'SELECT * FROM memory_links WHERE from_id = ? AND to_id = ? AND relation = ?',
    ).get(fromId, toId, relation);
    if (existing) return mapLink(existing);
    const createdAt = Date.now();
    const id = canonicalMemoryId('link', `${fromId}:${relation}:${toId}:${createdAt}`);
    this.db.prepare(
      'INSERT INTO memory_links (id, from_id, to_id, relation, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(id, fromId, toId, relation, createdAt);
    return mapLink(this.db.prepare('SELECT * FROM memory_links WHERE id = ?').get(id)!);
  }

  public listLinks(id: string): MemoryLinkRecord[] {
    return this.db.prepare(
      'SELECT * FROM memory_links WHERE from_id = ? OR to_id = ? ORDER BY created_at',
    ).all(id, id).map(mapLink);
  }

  public getById(id: string): { kind: MemoryKind; record: unknown } | null {
    if (!isCanonicalMemoryId(id)) return null;
    const { kind } = parseCanonicalMemoryId(id);
    const record = this.recordForKind(kind, id);
    return record ? { kind, record } : null;
  }

  private recordForKind(kind: MemoryKind, id: string): unknown {
    if (kind === 'entity') return this.getEntity(id);
    if (kind === 'fact') return this.getFact(id);
    if (kind === 'episode') return this.getEpisode(id);
    if (kind === 'observation') return this.getObservation(id);
    if (kind === 'relationship') return this.getRelationship(id);
    if (kind === 'artifact') return this.getArtifact(id);
    if (kind === 'alias') {
      const row = this.db.prepare('SELECT * FROM aliases WHERE id = ?').get(id);
      return row ? mapAlias(row) : null;
    }
    if (kind === 'identity') {
      const row = this.db.prepare('SELECT * FROM identity_settings WHERE id = ?').get(id);
      return row ? mapIdentity(row) : null;
    }
    if (kind === 'feedback') return this.db.prepare('SELECT * FROM memory_feedback WHERE id = ?').get(id) ?? null;
    if (kind === 'link') {
      const row = this.db.prepare('SELECT * FROM memory_links WHERE id = ?').get(id);
      return row ? mapLink(row) : null;
    }
    return null;
  }

  public forget(id: string): { kind: MemoryKind; id: string; status: MemoryStatus } | null {
    if (!isCanonicalMemoryId(id)) return null;
    const { kind } = parseCanonicalMemoryId(id);
    const table = tableForKind(kind);
    if (!table) return null;
    const current = this.db.prepare(`SELECT status FROM ${table} WHERE id = ?`).get(id);
    if (!current) return null;
    const next = applyForget({
      status: String(current.status || 'active') as MemoryStatus,
      retention: defaultRetention('long_lived'),
    });
    this.db.prepare(`UPDATE ${table} SET status = ? WHERE id = ?`).run(next.status, id);
    return { kind, id, status: next.status };
  }

  public expireDue(now = Date.now()): number {
    let changed = 0;
    for (const table of ['facts', 'episodes', 'entities', 'observations', 'artifacts']) {
      const result = this.db.prepare(
        `UPDATE ${table} SET status = 'expired' WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?`,
      ).run(now);
      changed += Number(result.changes || 0);
    }
    return changed;
  }

  private insertFact(record: SemanticFactRecord): void {
    this.db.prepare(`
      INSERT INTO facts (
        id, memory_type, subject_entity_id, predicate, object_value, fact_key, polarity, confidence,
        importance, confirmations, first_seen, last_confirmed, status, superseded_by, evidence_json,
        privacy_class, retention_class, expires_at, deletion_policy, source_system, source_record_id
      ) VALUES (?, 'semantic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        object_value = excluded.object_value,
        polarity = excluded.polarity,
        confidence = excluded.confidence,
        importance = excluded.importance,
        confirmations = excluded.confirmations,
        last_confirmed = excluded.last_confirmed,
        status = excluded.status,
        superseded_by = excluded.superseded_by,
        evidence_json = excluded.evidence_json
    `).run(
      record.id, record.subjectEntityId ?? null, record.predicate, record.objectValue, record.factKey,
      record.polarity, record.confidence, record.importance, record.provenance.confirmations,
      record.provenance.firstSeen, record.provenance.lastConfirmed, record.status,
      record.supersededBy ?? null, json(record.provenance.evidenceIds), record.privacyClass,
      record.retention.retentionClass, record.retention.expiresAt ?? null, record.retention.deletionPolicy,
      record.provenance.sourceSystem, record.provenance.sourceRecordId ?? null,
    );
  }

  private bumpFact(existing: SemanticFactRecord, incoming: SemanticFactRecord): SemanticFactRecord {
    const evidence = unique([...existing.provenance.evidenceIds, ...incoming.provenance.evidenceIds]);
    this.db.prepare(`
      UPDATE facts SET
        confirmations = ?,
        confidence = ?,
        last_confirmed = ?,
        evidence_json = ?
      WHERE id = ?
    `).run(
      existing.provenance.confirmations + 1,
      Math.min(0.98, Math.max(existing.confidence, incoming.confidence)),
      Math.max(existing.provenance.lastConfirmed, incoming.provenance.lastConfirmed),
      json(evidence),
      existing.id,
    );
    return this.getFact(existing.id)!;
  }

  private searchFactIds(query: string): string[] {
    try {
      const rows = this.db.prepare('SELECT id FROM facts_fts WHERE facts_fts MATCH ?').all(safeFts(query));
      if (rows.length > 0) return rows.map(row => String(row.id));
    } catch {
      // lexical fallback below
    }
    const like = `%${query.toLocaleLowerCase()}%`;
    return this.db.prepare(
      'SELECT id FROM facts WHERE lower(predicate) LIKE ? OR lower(object_value) LIKE ?',
    ).all(like, like).map(row => String(row.id));
  }

  private searchEpisodeIds(query: string): string[] {
    try {
      const rows = this.db.prepare('SELECT id FROM episodes_fts WHERE episodes_fts MATCH ?').all(safeFts(query));
      if (rows.length > 0) return rows.map(row => String(row.id));
    } catch {
      // lexical fallback below
    }
    const like = `%${query.toLocaleLowerCase()}%`;
    return this.db.prepare(
      'SELECT id FROM episodes WHERE lower(summary) LIKE ? OR lower(event_type) LIKE ?',
    ).all(like, like).map(row => String(row.id));
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function asStatuses(status?: MemoryStatus | MemoryStatus[]): MemoryStatus[] | undefined {
  if (!status) return ['active'];
  return Array.isArray(status) ? status : [status];
}

function safeFts(query: string): string {
  return query
    .trim()
    .split(/\s+/u)
    .map(token => token.replace(/["']/gu, ''))
    .filter(Boolean)
    .map(token => `"${token}"`)
    .join(' AND ');
}

function assertSafeArtifactPath(localPath: string): void {
  const clean = localPath.trim();
  if (!clean || clean.length > 1024) throw new Error('Artifact references must be short filesystem paths.');
  if (SECRET_NAME.test(clean)) throw new Error('Secrets must not be stored in the memory database.');
  if (/\x00/u.test(clean)) throw new Error('Artifact path is invalid.');
  if (clean.startsWith('data:') || clean.length > 256 && !/[\\/]/u.test(clean)) {
    throw new Error('Raw media bytes must not be stored in the memory database.');
  }
  if (FORBIDDEN_ARTIFACT.test(clean) && !/[\\/]/u.test(clean)) {
    throw new Error('Store an artifact path reference, not a raw media filename without a directory.');
  }
}

function tableForKind(kind: MemoryKind): string | null {
  switch (kind) {
    case 'entity': return 'entities';
    case 'fact': return 'facts';
    case 'episode': return 'episodes';
    case 'observation': return 'observations';
    case 'relationship': return 'relationships';
    case 'artifact': return 'artifacts';
    case 'alias': return 'aliases';
    case 'identity': return 'identity_settings';
    default: return null;
  }
}

function mapEntity(row: Record<string, unknown>): EntityRecord {
  const created = Number(row.created_at);
  return {
    id: String(row.id),
    kind: 'entity',
    entityType: row.entity_type as EntityRecord['entityType'],
    displayName: String(row.display_name),
    discordUserId: row.discord_user_id == null ? undefined : String(row.discord_user_id),
    status: (row.status as MemoryStatus) || 'active',
    privacyClass: row.privacy_class as PrivacyClass,
    confidence: Number(row.confidence ?? 1),
    importance: Number(row.importance ?? 0.7),
    supersededBy: row.superseded_by == null ? undefined : String(row.superseded_by),
    provenance: {
      sourceSystem: String(row.source_system),
      sourceRecordId: row.source_record_id == null ? undefined : String(row.source_record_id),
      evidenceIds: parseJsonArray(row.evidence_json),
      firstSeen: Number(row.first_seen ?? created),
      lastConfirmed: Number(row.last_confirmed ?? row.updated_at ?? created),
      confirmations: Number(row.confirmations ?? 1),
    },
    retention: {
      retentionClass: (row.retention_class as RetentionClass) || 'long_lived',
      deletionPolicy: (row.deletion_policy as EntityRecord['retention']['deletionPolicy']) || 'tombstone',
      ...(row.expires_at == null ? {} : { expiresAt: Number(row.expires_at) }),
    },
  };
}

function mapAlias(row: Record<string, unknown>): AliasRecord {
  return {
    id: String(row.id),
    entityId: String(row.entity_id),
    alias: String(row.alias),
    confidence: Number(row.confidence),
    evidenceIds: parseJsonArray(row.evidence_json),
    status: (row.status as MemoryStatus) || 'active',
  };
}

function mapRelationship(row: Record<string, unknown>): RelationshipRecord {
  const now = Number(row.updated_at ?? row.created_at ?? Date.now());
  return {
    id: String(row.id),
    kind: 'relationship',
    leftEntityId: String(row.left_entity_id),
    rightEntityId: String(row.right_entity_id),
    interactionCount: Number(row.interaction_count),
    lastInteractionAt: row.last_interaction_at == null ? undefined : Number(row.last_interaction_at),
    addressTerms: parseJsonObject(row.address_terms_json) as Record<string, number>,
    status: (row.status as MemoryStatus) || 'active',
    privacyClass: row.privacy_class as PrivacyClass,
    confidence: Number(row.confidence ?? 0.8),
    importance: Number(row.importance ?? 0.6),
    provenance: {
      sourceSystem: String(row.source_system || 'jarvis_memory'),
      evidenceIds: parseJsonArray(row.evidence_json),
      firstSeen: Number(row.created_at ?? now),
      lastConfirmed: now,
      confirmations: Number(row.interaction_count ?? 1),
    },
    retention: defaultRetention('long_lived', now),
  };
}

function mapObservation(row: Record<string, unknown>): ObservationRecord {
  return {
    id: String(row.id),
    kind: 'observation',
    occurredAt: Number(row.occurred_at),
    source: String(row.source),
    eventType: String(row.event_type),
    text: row.text == null ? undefined : String(row.text),
    actorEntityId: row.actor_entity_id == null ? undefined : String(row.actor_entity_id),
    guildId: row.guild_id == null ? undefined : String(row.guild_id),
    sessionId: row.session_id == null ? undefined : String(row.session_id),
    payload: parseJsonObject(row.payload_json),
    status: (row.status as MemoryStatus) || 'active',
    privacyClass: row.privacy_class as PrivacyClass,
    confidence: Number(row.confidence),
    importance: Number(row.importance ?? 0.4),
    provenance: {
      sourceSystem: String(row.source_system),
      sourceRecordId: row.source_record_id == null ? undefined : String(row.source_record_id),
      evidenceIds: parseJsonArray(row.evidence_json),
      firstSeen: Number(row.occurred_at),
      lastConfirmed: Number(row.occurred_at),
      confirmations: 1,
    },
    retention: {
      retentionClass: (row.retention_class as RetentionClass) || 'audit',
      deletionPolicy: (row.deletion_policy as ObservationRecord['retention']['deletionPolicy']) || 'retain_audit',
      ...(row.expires_at == null ? {} : { expiresAt: Number(row.expires_at) }),
    },
  };
}

function mapFact(row: Record<string, unknown>): SemanticFactRecord {
  return {
    id: String(row.id),
    kind: 'fact',
    subjectEntityId: row.subject_entity_id == null ? undefined : String(row.subject_entity_id),
    predicate: String(row.predicate),
    objectValue: String(row.object_value),
    factKey: String(row.fact_key),
    polarity: row.polarity as SemanticFactRecord['polarity'],
    status: row.status as MemoryStatus,
    privacyClass: row.privacy_class as PrivacyClass,
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    supersededBy: row.superseded_by == null ? undefined : String(row.superseded_by),
    provenance: {
      sourceSystem: String(row.source_system),
      sourceRecordId: row.source_record_id == null ? undefined : String(row.source_record_id),
      evidenceIds: parseJsonArray(row.evidence_json),
      firstSeen: Number(row.first_seen),
      lastConfirmed: Number(row.last_confirmed),
      confirmations: Number(row.confirmations),
    },
    retention: {
      retentionClass: row.retention_class as RetentionClass,
      deletionPolicy: row.deletion_policy as SemanticFactRecord['retention']['deletionPolicy'],
      ...(row.expires_at == null ? {} : { expiresAt: Number(row.expires_at) }),
    },
  };
}

function mapEpisode(row: Record<string, unknown>): EpisodeRecord {
  return {
    id: String(row.id),
    kind: 'episode',
    occurredAt: Number(row.occurred_at),
    source: String(row.source),
    eventType: String(row.event_type),
    summary: String(row.summary),
    payload: parseJsonObject(row.payload_json),
    status: row.status as MemoryStatus,
    privacyClass: row.privacy_class as PrivacyClass,
    confidence: Number(row.confidence),
    importance: Number(row.importance),
    supersededBy: row.superseded_by == null ? undefined : String(row.superseded_by),
    provenance: {
      sourceSystem: String(row.source_system),
      sourceRecordId: row.source_record_id == null ? undefined : String(row.source_record_id),
      evidenceIds: [],
      firstSeen: Number(row.occurred_at),
      lastConfirmed: Number(row.occurred_at),
      confirmations: 1,
    },
    retention: {
      retentionClass: row.retention_class as RetentionClass,
      deletionPolicy: row.deletion_policy as EpisodeRecord['retention']['deletionPolicy'],
      ...(row.expires_at == null ? {} : { expiresAt: Number(row.expires_at) }),
    },
  };
}

function mapArtifact(row: Record<string, unknown>): ArtifactRecord {
  const created = Number(row.created_at);
  return {
    id: String(row.id),
    kind: 'artifact',
    artifactKind: row.kind as ArtifactRecord['artifactKind'],
    localPath: String(row.local_path),
    sha256: row.sha256 == null ? undefined : String(row.sha256),
    status: (row.status as MemoryStatus) || 'active',
    privacyClass: row.privacy_class as PrivacyClass,
    confidence: 1,
    importance: 0.3,
    provenance: {
      sourceSystem: String(row.source_system),
      sourceRecordId: row.source_record_id == null ? undefined : String(row.source_record_id),
      evidenceIds: parseJsonArray(row.evidence_json),
      firstSeen: created,
      lastConfirmed: created,
      confirmations: 1,
    },
    retention: {
      retentionClass: row.retention_class as RetentionClass,
      deletionPolicy: 'tombstone',
      ...(row.expires_at == null ? {} : { expiresAt: Number(row.expires_at) }),
    },
  };
}

function mapIdentity(row: Record<string, unknown>): IdentitySettingRecord {
  return {
    id: String(row.id),
    settingKey: String(row.setting_key),
    settingValue: JSON.parse(String(row.setting_value_json)),
    updatedAt: Number(row.updated_at),
    sourceSystem: String(row.source_system),
    status: (row.status as MemoryStatus) || 'active',
  };
}

function mapLink(row: Record<string, unknown>): MemoryLinkRecord {
  return {
    id: String(row.id),
    fromId: String(row.from_id),
    toId: String(row.to_id),
    relation: String(row.relation),
    createdAt: Number(row.created_at),
  };
}

import {
  AliasRecord,
  ArtifactRecord,
  EntityRecord,
  EpisodeRecord,
  IdentitySettingRecord,
  MemoryClass,
  MemoryFeedbackRecord,
  MemoryKind,
  MemoryLinkRecord,
  MemoryStatus,
  ObservationRecord,
  RelationshipRecord,
  SemanticCandidate,
  SemanticFactRecord,
} from './types';

export type FactWriteOptions = {
  allowConflict?: boolean;
};

export type MemoryListFilter = {
  factKey?: string;
  status?: MemoryStatus | MemoryStatus[];
  query?: string;
  limit?: number;
  memoryClass?: MemoryClass | MemoryClass[];
};

export interface JarvisMemoryStore {
  readonly dbPath: string;
  schemaVersion(): number;
  close(): void;

  putEntity(record: EntityRecord): EntityRecord;
  getEntity(id: string): EntityRecord | null;
  putAlias(entityId: string, alias: string, confidence?: number, evidenceIds?: string[]): AliasRecord;
  listAliases(entityId: string): AliasRecord[];

  putRelationship(record: RelationshipRecord): RelationshipRecord;
  getRelationship(id: string): RelationshipRecord | null;

  putObservation(record: ObservationRecord): ObservationRecord;
  getObservation(id: string): ObservationRecord | null;

  putFact(record: SemanticFactRecord, options?: FactWriteOptions): SemanticFactRecord;
  getFact(id: string): SemanticFactRecord | null;
  listFacts(filter?: MemoryListFilter): SemanticFactRecord[];
  supersedeFact(previousId: string, next: SemanticFactRecord): { previous: SemanticFactRecord; next: SemanticFactRecord };

  putEpisode(record: EpisodeRecord): EpisodeRecord;
  getEpisode(id: string): EpisodeRecord | null;
  listEpisodes(filter?: MemoryListFilter): EpisodeRecord[];

  putArtifact(record: ArtifactRecord): ArtifactRecord;
  getArtifact(id: string): ArtifactRecord | null;

  putIdentitySetting(key: string, value: unknown, sourceSystem: string): IdentitySettingRecord;
  getIdentitySetting(key: string): IdentitySettingRecord | null;

  putFeedback(targetId: string, action: MemoryFeedbackRecord['action'], note?: string, actor?: string): MemoryFeedbackRecord;
  link(fromId: string, toId: string, relation: string): MemoryLinkRecord;
  listLinks(id: string): MemoryLinkRecord[];

  getById(id: string): { kind: MemoryKind; record: unknown } | null;
  forget(id: string): { kind: MemoryKind; id: string; status: MemoryStatus } | null;
  expireDue(now?: number): number;

  putCandidate(record: SemanticCandidate): SemanticCandidate;
  getCandidate(id: string): SemanticCandidate | null;
  listCandidates(filter?: { status?: SemanticCandidate['status'] | SemanticCandidate['status'][]; episodeId?: string; limit?: number }): SemanticCandidate[];
  acceptCandidate(id: string, options?: { actor?: string }): { candidate: SemanticCandidate; fact: SemanticFactRecord };
  rejectCandidate(id: string, reason?: string): SemanticCandidate;
}

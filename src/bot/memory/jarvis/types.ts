export const JARVIS_MEMORY_SCHEMA_VERSION = 3;

export const MEMORY_KINDS = [
  'entity',
  'alias',
  'relationship',
  'observation',
  'fact',
  'episode',
  'session',
  'artifact',
  'identity',
  'permission',
  'link',
  'feedback',
] as const;

export type MemoryKind = typeof MEMORY_KINDS[number];

export const MEMORY_STATUSES = ['active', 'superseded', 'forgotten', 'expired'] as const;
export type MemoryStatus = typeof MEMORY_STATUSES[number];

export const PRIVACY_CLASSES = ['public', 'private', 'sensitive', 'secret'] as const;
export type PrivacyClass = typeof PRIVACY_CLASSES[number];

export const RETENTION_CLASSES = ['ephemeral', 'session', 'short_lived', 'long_lived', 'artifact', 'audit'] as const;
export type RetentionClass = typeof RETENTION_CLASSES[number];

export const DELETION_POLICIES = ['retain_audit', 'hard_delete', 'tombstone'] as const;
export type DeletionPolicy = typeof DELETION_POLICIES[number];

export const FACT_POLARITIES = ['positive', 'negative', 'statement'] as const;
export type FactPolarity = typeof FACT_POLARITIES[number];

export const FEEDBACK_ACTIONS = ['remember', 'correct', 'ignore', 'forget', 'emphasize', 'identify'] as const;
export type FeedbackAction = typeof FEEDBACK_ACTIONS[number];

export type Provenance = {
  sourceSystem: string;
  sourceRecordId?: string;
  evidenceIds: string[];
  firstSeen: number;
  lastConfirmed: number;
  confirmations: number;
};

export type RetentionPolicy = {
  retentionClass: RetentionClass;
  deletionPolicy: DeletionPolicy;
  expiresAt?: number;
};

export interface CanonicalMemoryRecord {
  id: string;
  kind: MemoryKind;
  status: MemoryStatus;
  privacyClass: PrivacyClass;
  confidence: number;
  importance: number;
  provenance: Provenance;
  retention: RetentionPolicy;
  supersededBy?: string;
}

export interface EntityRecord extends CanonicalMemoryRecord {
  kind: 'entity';
  entityType: 'person' | 'project' | 'device' | 'place' | 'organization' | 'other';
  displayName: string;
  discordUserId?: string;
}

export interface SemanticFactRecord extends CanonicalMemoryRecord {
  kind: 'fact';
  subjectEntityId?: string;
  predicate: string;
  objectValue: string;
  factKey: string;
  polarity: FactPolarity;
}

export interface EpisodeRecord extends CanonicalMemoryRecord {
  kind: 'episode';
  occurredAt: number;
  source: string;
  eventType: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface ObservationRecord extends CanonicalMemoryRecord {
  kind: 'observation';
  occurredAt: number;
  source: string;
  eventType: string;
  text?: string;
  actorEntityId?: string;
  guildId?: string;
  sessionId?: string;
  payload: Record<string, unknown>;
}

export interface RelationshipRecord extends CanonicalMemoryRecord {
  kind: 'relationship';
  leftEntityId: string;
  rightEntityId: string;
  interactionCount: number;
  lastInteractionAt?: number;
  addressTerms: Record<string, number>;
}

export interface ArtifactRecord extends CanonicalMemoryRecord {
  kind: 'artifact';
  artifactKind: 'audio' | 'image' | 'video' | 'document' | 'snapshot' | 'other';
  localPath: string;
  sha256?: string;
}

export interface AliasRecord {
  id: string;
  entityId: string;
  alias: string;
  confidence: number;
  evidenceIds: string[];
  status: MemoryStatus;
}

export interface IdentitySettingRecord {
  id: string;
  settingKey: string;
  settingValue: unknown;
  updatedAt: number;
  sourceSystem: string;
  status: MemoryStatus;
}

export interface MemoryFeedbackRecord {
  id: string;
  targetId: string;
  action: FeedbackAction;
  note?: string;
  createdAt: number;
  actor: string;
}

export interface MemoryLinkRecord {
  id: string;
  fromId: string;
  toId: string;
  relation: string;
  createdAt: number;
}

export class MemoryConflictError extends Error {
  constructor(
    public readonly existingId: string,
    public readonly factKey: string,
  ) {
    super(`Active fact ${existingId} already occupies ${factKey}; supersede instead of overwrite.`);
    this.name = 'MemoryConflictError';
  }
}

export type QdrantMemoryPayload = {
  memory_type: MemoryKind;
  canonical_id: string;
  person_ids: string[];
  source: string;
  occurred_at: string;
  privacy: PrivacyClass;
  importance: number;
  confidence: number;
  status: MemoryStatus;
};

export const REQUIRED_SCHEMA_TABLES = [
  'schema_migrations',
  'entities',
  'aliases',
  'relationships',
  'observations',
  'facts',
  'episodes',
  'sessions',
  'artifacts',
  'identity_settings',
  'permissions',
  'memory_links',
  'memory_feedback',
  'consolidation_runs',
  'facts_fts',
  'episodes_fts',
] as const;

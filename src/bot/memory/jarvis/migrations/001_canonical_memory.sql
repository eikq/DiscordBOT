-- Digital Me / Jarvis canonical memory schema
-- Version: 1
-- Status: design only. Do not run against existing user data yet.
-- SQLite is the intended source of truth. JSONL remains the current SocialMemoryBrain audit stream.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'project', 'device', 'place', 'organization', 'other')),
  display_name TEXT NOT NULL,
  discord_user_id TEXT,
  privacy_class TEXT NOT NULL DEFAULT 'private' CHECK (privacy_class IN ('public', 'private', 'sensitive', 'secret')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  source_system TEXT NOT NULL,
  source_record_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_discord_user
  ON entities(discord_user_id)
  WHERE discord_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  UNIQUE (entity_id, alias)
);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  left_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  right_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  last_interaction_at INTEGER,
  address_terms_json TEXT NOT NULL DEFAULT '{}',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  privacy_class TEXT NOT NULL DEFAULT 'private' CHECK (privacy_class IN ('public', 'private', 'sensitive', 'secret')),
  CHECK (left_entity_id < right_entity_id)
);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  actor_entity_id TEXT REFERENCES entities(id),
  event_type TEXT NOT NULL,
  text TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  privacy_class TEXT NOT NULL DEFAULT 'private' CHECK (privacy_class IN ('public', 'private', 'sensitive', 'secret')),
  guild_id TEXT,
  session_id TEXT,
  source_system TEXT NOT NULL,
  source_record_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_observations_occurred_at ON observations(occurred_at);
CREATE INDEX IF NOT EXISTS idx_observations_actor ON observations(actor_entity_id);

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL DEFAULT 'semantic' CHECK (memory_type IN ('semantic', 'social', 'identity')),
  subject_entity_id TEXT REFERENCES entities(id),
  predicate TEXT NOT NULL,
  object_value TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  polarity TEXT NOT NULL DEFAULT 'statement' CHECK (polarity IN ('positive', 'negative', 'statement')),
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  confirmations INTEGER NOT NULL DEFAULT 1,
  first_seen INTEGER NOT NULL,
  last_confirmed INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'forgotten', 'expired')),
  superseded_by TEXT REFERENCES facts(id),
  evidence_json TEXT NOT NULL DEFAULT '[]',
  privacy_class TEXT NOT NULL DEFAULT 'private' CHECK (privacy_class IN ('public', 'private', 'sensitive', 'secret')),
  retention_class TEXT NOT NULL DEFAULT 'long_lived' CHECK (retention_class IN ('ephemeral', 'session', 'short_lived', 'long_lived', 'artifact', 'audit')),
  expires_at INTEGER,
  deletion_policy TEXT NOT NULL DEFAULT 'tombstone' CHECK (deletion_policy IN ('retain_audit', 'hard_delete', 'tombstone')),
  source_system TEXT NOT NULL,
  source_record_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_facts_key_status ON facts(fact_key, status);
CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject_entity_id);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  occurred_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  importance REAL NOT NULL DEFAULT 0.5 CHECK (importance >= 0 AND importance <= 1),
  privacy_class TEXT NOT NULL DEFAULT 'private' CHECK (privacy_class IN ('public', 'private', 'sensitive', 'secret')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'forgotten', 'expired')),
  superseded_by TEXT REFERENCES episodes(id),
  expires_at INTEGER,
  retention_class TEXT NOT NULL DEFAULT 'short_lived' CHECK (retention_class IN ('ephemeral', 'session', 'short_lived', 'long_lived', 'artifact', 'audit')),
  deletion_policy TEXT NOT NULL DEFAULT 'tombstone' CHECK (deletion_policy IN ('retain_audit', 'hard_delete', 'tombstone')),
  source_system TEXT NOT NULL,
  source_record_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_episodes_occurred_at ON episodes(occurred_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  source TEXT NOT NULL,
  guild_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('audio', 'image', 'video', 'document', 'snapshot', 'other')),
  local_path TEXT NOT NULL,
  sha256 TEXT,
  privacy_class TEXT NOT NULL DEFAULT 'sensitive' CHECK (privacy_class IN ('public', 'private', 'sensitive', 'secret')),
  retention_class TEXT NOT NULL DEFAULT 'artifact' CHECK (retention_class IN ('ephemeral', 'session', 'short_lived', 'long_lived', 'artifact', 'audit')),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  source_system TEXT NOT NULL,
  source_record_id TEXT
);

CREATE TABLE IF NOT EXISTS identity_settings (
  id TEXT PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  setting_value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  source_system TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  action_class TEXT NOT NULL CHECK (action_class IN ('READ', 'LOCAL_SAFE_WRITE', 'EXTERNAL_WRITE', 'DESTRUCTIVE')),
  resource TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_links (
  id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_links_from ON memory_links(from_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_to ON memory_links(to_id);

CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('remember', 'correct', 'ignore', 'forget', 'emphasize', 'identify')),
  note TEXT,
  created_at INTEGER NOT NULL,
  actor TEXT NOT NULL DEFAULT 'owner'
);

CREATE TABLE IF NOT EXISTS consolidation_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
  summary_json TEXT NOT NULL DEFAULT '{}'
);

CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
  id UNINDEXED,
  predicate,
  object_value,
  content='facts',
  content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
  id UNINDEXED,
  summary,
  event_type,
  content='episodes',
  content_rowid='rowid'
);

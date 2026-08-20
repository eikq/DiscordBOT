-- Canonical Memory Intelligence V2.
-- SQLite remains canonical truth. Vector/Qdrant stays a derived index.
-- Adds owner-trust, derived, product memory class, timestamps, supersedes,
-- and episode→semantic candidates (never auto-trusted from research).
-- Never run against data/brain JSON or JSONL files.

PRAGMA foreign_keys = ON;

ALTER TABLE facts ADD COLUMN owner_trusted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE facts ADD COLUMN derived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE facts ADD COLUMN memory_class TEXT NOT NULL DEFAULT 'semantic'
  CHECK(memory_class IN ('working', 'episodic', 'semantic', 'procedural', 'social', 'identity', 'perceptual'));
ALTER TABLE facts ADD COLUMN created_at INTEGER;
ALTER TABLE facts ADD COLUMN updated_at INTEGER;
ALTER TABLE facts ADD COLUMN supersedes TEXT;

ALTER TABLE episodes ADD COLUMN owner_trusted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE episodes ADD COLUMN derived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE episodes ADD COLUMN memory_class TEXT NOT NULL DEFAULT 'episodic'
  CHECK(memory_class IN ('working', 'episodic', 'semantic', 'procedural', 'social', 'identity', 'perceptual'));
ALTER TABLE episodes ADD COLUMN created_at INTEGER;
ALTER TABLE episodes ADD COLUMN updated_at INTEGER;

ALTER TABLE entities ADD COLUMN memory_class TEXT NOT NULL DEFAULT 'semantic'
  CHECK(memory_class IN ('working', 'episodic', 'semantic', 'procedural', 'social', 'identity', 'perceptual'));
ALTER TABLE observations ADD COLUMN memory_class TEXT NOT NULL DEFAULT 'perceptual'
  CHECK(memory_class IN ('working', 'episodic', 'semantic', 'procedural', 'social', 'identity', 'perceptual'));
ALTER TABLE identity_settings ADD COLUMN owner_trusted INTEGER NOT NULL DEFAULT 1;
ALTER TABLE identity_settings ADD COLUMN memory_class TEXT NOT NULL DEFAULT 'identity'
  CHECK(memory_class IN ('working', 'episodic', 'semantic', 'procedural', 'social', 'identity', 'perceptual'));

CREATE TABLE IF NOT EXISTS semantic_candidates (
  id TEXT PRIMARY KEY,
  episode_id TEXT,
  fact_key TEXT NOT NULL,
  value TEXT NOT NULL,
  significance REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'candidate'
    CHECK(status IN ('candidate', 'accepted', 'rejected')),
  reason TEXT NOT NULL DEFAULT '',
  owner_trusted INTEGER NOT NULL DEFAULT 0,
  derived INTEGER NOT NULL DEFAULT 1,
  source_system TEXT NOT NULL DEFAULT 'unknown',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_facts_memory_class ON facts(memory_class, status);
CREATE INDEX IF NOT EXISTS idx_facts_owner_trusted ON facts(owner_trusted, status);
CREATE INDEX IF NOT EXISTS idx_candidates_status ON semantic_candidates(status, significance);
CREATE INDEX IF NOT EXISTS idx_candidates_episode ON semantic_candidates(episode_id);

UPDATE facts
SET created_at = COALESCE(created_at, first_seen),
    updated_at = COALESCE(updated_at, last_confirmed);

UPDATE episodes
SET created_at = COALESCE(created_at, occurred_at),
    updated_at = COALESCE(updated_at, occurred_at);

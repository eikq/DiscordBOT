-- Digital Me / Jarvis canonical memory schema
-- Version: 2
-- Adds lifecycle/provenance columns required by MEMORY-002.
-- Never run against data/brain JSON or JSONL files.

PRAGMA foreign_keys = ON;

ALTER TABLE entities ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE entities ADD COLUMN confidence REAL NOT NULL DEFAULT 1;
ALTER TABLE entities ADD COLUMN importance REAL NOT NULL DEFAULT 0.7;
ALTER TABLE entities ADD COLUMN superseded_by TEXT REFERENCES entities(id);
ALTER TABLE entities ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'long_lived';
ALTER TABLE entities ADD COLUMN expires_at INTEGER;
ALTER TABLE entities ADD COLUMN deletion_policy TEXT NOT NULL DEFAULT 'tombstone';
ALTER TABLE entities ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE entities ADD COLUMN confirmations INTEGER NOT NULL DEFAULT 1;
ALTER TABLE entities ADD COLUMN first_seen INTEGER;
ALTER TABLE entities ADD COLUMN last_confirmed INTEGER;

ALTER TABLE aliases ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE aliases ADD COLUMN source_system TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE relationships ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE relationships ADD COLUMN confidence REAL NOT NULL DEFAULT 0.8;
ALTER TABLE relationships ADD COLUMN importance REAL NOT NULL DEFAULT 0.6;
ALTER TABLE relationships ADD COLUMN source_system TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE relationships ADD COLUMN created_at INTEGER;
ALTER TABLE relationships ADD COLUMN updated_at INTEGER;

ALTER TABLE observations ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE observations ADD COLUMN importance REAL NOT NULL DEFAULT 0.4;
ALTER TABLE observations ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'audit';
ALTER TABLE observations ADD COLUMN expires_at INTEGER;
ALTER TABLE observations ADD COLUMN deletion_policy TEXT NOT NULL DEFAULT 'retain_audit';
ALTER TABLE observations ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE artifacts ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE artifacts ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE identity_settings ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE identity_settings ADD COLUMN privacy_class TEXT NOT NULL DEFAULT 'private';

CREATE INDEX IF NOT EXISTS idx_facts_expires_at ON facts(expires_at);
CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);
CREATE INDEX IF NOT EXISTS idx_entities_status ON entities(status);

CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
  INSERT INTO facts_fts(rowid, id, predicate, object_value)
  VALUES (new.rowid, new.id, new.predicate, new.object_value);
END;

CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, id, predicate, object_value)
  VALUES ('delete', old.rowid, old.id, old.predicate, old.object_value);
  INSERT INTO facts_fts(rowid, id, predicate, object_value)
  VALUES (new.rowid, new.id, new.predicate, new.object_value);
END;

CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
  INSERT INTO facts_fts(facts_fts, rowid, id, predicate, object_value)
  VALUES ('delete', old.rowid, old.id, old.predicate, old.object_value);
END;

CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
  INSERT INTO episodes_fts(rowid, id, summary, event_type)
  VALUES (new.rowid, new.id, new.summary, new.event_type);
END;

CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE ON episodes BEGIN
  INSERT INTO episodes_fts(episodes_fts, rowid, id, summary, event_type)
  VALUES ('delete', old.rowid, old.id, old.summary, old.event_type);
  INSERT INTO episodes_fts(rowid, id, summary, event_type)
  VALUES (new.rowid, new.id, new.summary, new.event_type);
END;

CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
  INSERT INTO episodes_fts(episodes_fts, rowid, id, summary, event_type)
  VALUES ('delete', old.rowid, old.id, old.summary, old.event_type);
END;

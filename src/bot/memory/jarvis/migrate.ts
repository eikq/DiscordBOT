import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { listSchemaMigrations } from './schema';
import { JARVIS_MEMORY_SCHEMA_VERSION } from './types';

export function defaultJarvisDbPath(): string {
  return path.join(process.cwd(), 'data', 'jarvis', 'jarvis.db');
}

export function openMigratedDatabase(dbPath: string): DatabaseSync {
  if (path.normalize(dbPath).includes(`${path.sep}data${path.sep}brain${path.sep}`)) {
    throw new Error('Refusing to open a SQLite store inside data/brain; JSON/JSONL files stay untouched.');
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA foreign_keys = ON');
  applySchemaMigrations(db);
  return db;
}

export function applySchemaMigrations(db: DatabaseSync): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      description TEXT NOT NULL
    )
  `);
  recoverUnversionedV1(db);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(row => Number(row.version)),
  );
  for (const migration of listSchemaMigrations()) {
    if (applied.has(migration.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations(version, applied_at, description) VALUES (?, ?, ?)',
      ).run(migration.version, Date.now(), migration.description);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  const current = currentSchemaVersion(db);
  if (current < JARVIS_MEMORY_SCHEMA_VERSION) {
    throw new Error(`Memory schema is ${current}; expected ${JARVIS_MEMORY_SCHEMA_VERSION}.`);
  }
  return current;
}

export function currentSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  return Number(row?.version || 0);
}

function recoverUnversionedV1(db: DatabaseSync): void {
  const facts = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'facts'",
  ).get();
  const counted = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get();
  if (facts && Number(counted?.n || 0) === 0) {
    db.prepare(
      'INSERT INTO schema_migrations(version, applied_at, description) VALUES (?, ?, ?)',
    ).run(1, Date.now(), 'Recovered unversioned v1 schema');
  }
}

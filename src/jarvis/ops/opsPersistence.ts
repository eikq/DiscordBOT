import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { JsonCollection } from '../evolution/persistTypes';
import { defaultRuntimeRoot, openOperationalSqlite } from '../storage/operationalDb';

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS json_docs (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(collection, id)
);
CREATE TABLE IF NOT EXISTS traces (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS traces_at ON traces(at);
`;

export function defaultOpsDbPath(workspaceRoot = process.cwd()): string {
  return path.join(defaultRuntimeRoot(workspaceRoot), 'ops.db');
}

/**
 * Isolated operational store for traces, runtime specs, model profiles,
 * certifications, and artifact tasks. Must never reuse jarvis.db / memory.db.
 */
export class OpsPersistence {
  public readonly dbPath: string;
  public readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const opened = openOperationalSqlite(dbPath, 'Jarvis ops store');
    this.db = opened.db;
    this.dbPath = opened.path;
    this.db.exec(SCHEMA);
    const current = Number(this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version || 0);
    if (current < SCHEMA_VERSION) {
      this.db.prepare('INSERT INTO schema_migrations(version, applied_at, description) VALUES (?, ?, ?)').run(
        SCHEMA_VERSION,
        new Date().toISOString(),
        'ops v1 traces + json_docs',
      );
    }
  }

  public collection<T>(name: string, idOf: (item: T) => string): JsonCollection<T> {
    return {
      load: () => {
        const rows = this.db.prepare('SELECT payload FROM json_docs WHERE collection = ?').all(name) as Array<{ payload: string }>;
        return rows.map(row => JSON.parse(String(row.payload)) as T);
      },
      replace: (items: T[]) => {
        this.db.exec('BEGIN');
        try {
          this.db.prepare('DELETE FROM json_docs WHERE collection = ?').run(name);
          const insert = this.db.prepare('INSERT INTO json_docs(collection, id, payload, updated_at) VALUES (?, ?, ?, ?)');
          const at = new Date().toISOString();
          for (const item of items) {
            insert.run(name, idOf(item), JSON.stringify(item), at);
          }
          this.db.exec('COMMIT');
        } catch (error) {
          this.db.exec('ROLLBACK');
          throw error;
        }
      },
    };
  }

  public close(): void {
    this.db.close();
  }
}

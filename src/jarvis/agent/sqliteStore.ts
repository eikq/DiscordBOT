import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { defaultRuntimeRoot, openOperationalSqlite } from '../storage/operationalDb';
import type { WorkTask } from './types';
import { recoverInterruptedTask } from './recoveryState';

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_tasks (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  outcome TEXT,
  simulated INTEGER NOT NULL DEFAULT 0,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_tasks_status ON work_tasks(status, updated_at);
`;

export function defaultWorkDbPath(workspaceRoot = process.cwd()): string {
  return path.join(defaultRuntimeRoot(workspaceRoot), 'work.db');
}

export class SqliteWorkTaskPersistence {
  public readonly dbPath: string;
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const opened = openOperationalSqlite(dbPath, 'Work task store');
    this.db = opened.db;
    this.dbPath = opened.path;
    this.db.exec(SCHEMA);
    const current = Number(this.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version || 0);
    if (current < SCHEMA_VERSION) {
      this.db.prepare('INSERT INTO schema_migrations(version, applied_at, description) VALUES (?, ?, ?)').run(
        SCHEMA_VERSION,
        new Date().toISOString(),
        'work tasks v1',
      );
    }
  }

  public load(): WorkTask[] {
    const rows = this.db.prepare('SELECT payload FROM work_tasks ORDER BY updated_at ASC').all() as Array<{ payload: string }>;
    return rows.map(row => recoverInterruptedTask(JSON.parse(String(row.payload)) as WorkTask));
  }

  public upsert(task: WorkTask): void {
    this.db.prepare(`
      INSERT INTO work_tasks(id, status, outcome, simulated, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        outcome = excluded.outcome,
        simulated = excluded.simulated,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(
      task.id,
      task.status,
      task.outcome ?? null,
      task.simulated ? 1 : 0,
      JSON.stringify(task),
      task.createdAt,
      task.updatedAt,
    );
  }

  public close(): void {
    this.db.close();
  }
}

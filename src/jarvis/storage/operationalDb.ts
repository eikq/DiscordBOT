import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const FORBIDDEN_BASENAMES = new Set([
  'jarvis.db',
  'memory.db',
  'automation.db',
  'workspace.db',
  'research.db',
]);

export function assertOperationalDbPath(dbPath: string, label: string): string {
  const resolved = path.resolve(dbPath);
  const base = path.basename(resolved).toLowerCase();
  if (FORBIDDEN_BASENAMES.has(base) || path.normalize(resolved).includes(`${path.sep}data${path.sep}brain${path.sep}`)) {
    throw new Error(`${label} must not reuse canonical memory, brain, reminder, research, or workspace databases.`);
  }
  return resolved;
}

export function openOperationalSqlite(dbPath: string, label: string): { db: DatabaseSync; path: string } {
  const resolved = assertOperationalDbPath(dbPath, label);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved, { enableForeignKeyConstraints: true });
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return { db, path: resolved };
}

export function defaultRuntimeRoot(workspaceRoot = process.cwd()): string {
  return path.join(workspaceRoot, 'data', 'jarvis', 'runtime');
}

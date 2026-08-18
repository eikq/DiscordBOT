import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JARVIS_MEMORY_SCHEMA_VERSION, REQUIRED_SCHEMA_TABLES } from './types';

export function canonicalSchemaSqlPath(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations', '001_canonical_memory.sql');
}

export function loadCanonicalSchemaSql(): string {
  return fs.readFileSync(canonicalSchemaSqlPath(), 'utf8');
}

export function assertCanonicalSchemaSql(sql = loadCanonicalSchemaSql()): string[] {
  const missing = REQUIRED_SCHEMA_TABLES.filter(table => {
    const pattern = new RegExp(`CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS ${table}\\b`, 'iu');
    return !pattern.test(sql);
  });
  if (missing.length > 0) {
    throw new Error(`Canonical schema is missing tables: ${missing.join(', ')}`);
  }
  if (!sql.includes(`Version: ${JARVIS_MEMORY_SCHEMA_VERSION}`)) {
    throw new Error(`Canonical schema must declare version ${JARVIS_MEMORY_SCHEMA_VERSION}.`);
  }
  if (!/PRAGMA foreign_keys = ON/iu.test(sql)) {
    throw new Error('Canonical schema must enable foreign keys.');
  }
  if (!/Do not run against existing user data yet/iu.test(sql)) {
    throw new Error('Canonical schema must remain a non-destructive design until an explicit migration task.');
  }
  return [...REQUIRED_SCHEMA_TABLES];
}

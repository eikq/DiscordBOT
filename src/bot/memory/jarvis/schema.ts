import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REQUIRED_SCHEMA_TABLES } from './types';

export function migrationsDirectory(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
}

export function canonicalSchemaSqlPath(): string {
  return path.join(migrationsDirectory(), '001_canonical_memory.sql');
}

export function loadCanonicalSchemaSql(): string {
  return fs.readFileSync(canonicalSchemaSqlPath(), 'utf8');
}

export type SchemaMigrationFile = {
  version: number;
  fileName: string;
  filePath: string;
  description: string;
  sql: string;
};

export function listSchemaMigrations(): SchemaMigrationFile[] {
  return fs.readdirSync(migrationsDirectory())
    .filter(fileName => /^\d{3}_.+\.sql$/u.test(fileName))
    .map(fileName => {
      const filePath = path.join(migrationsDirectory(), fileName);
      const sql = fs.readFileSync(filePath, 'utf8');
      const version = Number(fileName.slice(0, 3));
      const description = sql.match(/^--\s*(.+)$/mu)?.[1]?.trim() || fileName;
      return { version, fileName, filePath, description, sql };
    })
    .sort((left, right) => left.version - right.version);
}

export function assertCanonicalSchemaSql(sql = loadCanonicalSchemaSql()): string[] {
  const missing = REQUIRED_SCHEMA_TABLES.filter(table => {
    const pattern = new RegExp(`CREATE (?:VIRTUAL )?TABLE IF NOT EXISTS ${table}\\b`, 'iu');
    return !pattern.test(sql);
  });
  if (missing.length > 0) {
    throw new Error(`Canonical schema is missing tables: ${missing.join(', ')}`);
  }
  if (!/Version:\s*1\b/u.test(sql)) {
    throw new Error('Base canonical schema must declare version 1.');
  }
  if (!/PRAGMA foreign_keys = ON/iu.test(sql)) {
    throw new Error('Canonical schema must enable foreign keys.');
  }
  if (!/Never run against data\/brain/iu.test(sql)) {
    throw new Error('Canonical schema must refuse to run against data/brain JSON or JSONL files.');
  }
  return [...REQUIRED_SCHEMA_TABLES];
}

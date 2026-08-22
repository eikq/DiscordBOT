import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { jarvisDataRoot } from '../edition/resolve';
import {
  FETCH_CACHE_TTL_MS,
  MAX_SESSIONS,
  RESEARCH_SCHEMA_VERSION,
  SEARCH_CACHE_TTL_MS,
  SESSION_RETENTION_MS,
} from './constants';
import type { ResearchResult, SearchHit } from './types';

export type ResearchStore = {
  putSearch(query: string, hits: SearchHit[], nowMs: number): void;
  getSearch(query: string, nowMs: number, allowStale: boolean): { hits: SearchHit[]; cached: boolean; fetchedAt: string } | null;
  putFetch(url: string, body: string, contentType: string, nowMs: number): void;
  getFetch(url: string, nowMs: number, allowStale: boolean): { body: string; contentType: string; cached: boolean; fetchedAt: string } | null;
  putSession(result: ResearchResult): void;
  getSession(sessionId: string): ResearchResult | null;
  lastSession(): ResearchResult | null;
  prune(nowMs: number): void;
  close(): void;
};

const FORBIDDEN_DB = new Set(['jarvis.db', 'memory.db', 'automation.db', 'workspace.db']);

export function defaultResearchDbPath(workspaceRoot = process.cwd()): string {
  return path.join(jarvisDataRoot(workspaceRoot), 'research', 'research.db');
}

export function createResearchStore(dbPath: string): ResearchStore {
  const resolved = path.resolve(dbPath);
  const base = path.basename(resolved).toLowerCase();
  if (FORBIDDEN_DB.has(base) || path.normalize(resolved).includes(`${path.sep}data${path.sep}brain${path.sep}`)) {
    throw new Error('Research store must not reuse canonical memory, brain, or reminder databases.');
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved, { enableForeignKeyConstraints: true });
  db.exec(`
    CREATE TABLE IF NOT EXISTS research_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS search_cache (
      query_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fetch_cache (
      url_key TEXT PRIMARY KEY,
      content_type TEXT NOT NULL,
      body TEXT NOT NULL,
      fetched_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      researched_at INTEGER NOT NULL
    );
  `);
  db.prepare('INSERT OR REPLACE INTO research_meta(key, value) VALUES (?, ?)').run('schema', String(RESEARCH_SCHEMA_VERSION));

  return {
    putSearch(query, hits, nowMs) {
      db.prepare('INSERT OR REPLACE INTO search_cache(query_key, payload, fetched_at) VALUES (?, ?, ?)').run(
        normalizeQuery(query),
        JSON.stringify(hits),
        nowMs,
      );
    },
    getSearch(query, nowMs, allowStale) {
      const row = db.prepare('SELECT payload, fetched_at FROM search_cache WHERE query_key = ?').get(normalizeQuery(query)) as
        | { payload: string; fetched_at: number }
        | undefined;
      if (!row) return null;
      if (!allowStale && nowMs - Number(row.fetched_at) > SEARCH_CACHE_TTL_MS) return null;
      return {
        hits: JSON.parse(String(row.payload)) as SearchHit[],
        cached: true,
        fetchedAt: new Date(Number(row.fetched_at)).toISOString(),
      };
    },
    putFetch(url, body, contentType, nowMs) {
      db.prepare('INSERT OR REPLACE INTO fetch_cache(url_key, content_type, body, fetched_at) VALUES (?, ?, ?, ?)').run(
        url,
        contentType,
        body.slice(0, 80_000),
        nowMs,
      );
    },
    getFetch(url, nowMs, allowStale) {
      const row = db.prepare('SELECT content_type, body, fetched_at FROM fetch_cache WHERE url_key = ?').get(url) as
        | { content_type: string; body: string; fetched_at: number }
        | undefined;
      if (!row) return null;
      if (!allowStale && nowMs - Number(row.fetched_at) > FETCH_CACHE_TTL_MS) return null;
      return {
        body: String(row.body),
        contentType: String(row.content_type),
        cached: true,
        fetchedAt: new Date(Number(row.fetched_at)).toISOString(),
      };
    },
    putSession(result) {
      db.prepare('INSERT OR REPLACE INTO sessions(session_id, payload, researched_at) VALUES (?, ?, ?)').run(
        result.sessionId,
        JSON.stringify(result),
        Date.parse(result.researchedAt) || Date.now(),
      );
    },
    getSession(sessionId) {
      const row = db.prepare('SELECT payload FROM sessions WHERE session_id = ?').get(sessionId) as { payload: string } | undefined;
      return row ? JSON.parse(String(row.payload)) as ResearchResult : null;
    },
    lastSession() {
      const row = db.prepare('SELECT payload FROM sessions ORDER BY researched_at DESC LIMIT 1').get() as { payload: string } | undefined;
      return row ? JSON.parse(String(row.payload)) as ResearchResult : null;
    },
    prune(nowMs) {
      db.prepare('DELETE FROM search_cache WHERE fetched_at < ?').run(nowMs - SEARCH_CACHE_TTL_MS * 6);
      db.prepare('DELETE FROM fetch_cache WHERE fetched_at < ?').run(nowMs - FETCH_CACHE_TTL_MS * 4);
      db.prepare('DELETE FROM sessions WHERE researched_at < ?').run(nowMs - SESSION_RETENTION_MS);
      const extras = db.prepare('SELECT session_id FROM sessions ORDER BY researched_at DESC LIMIT -1 OFFSET ?').all(MAX_SESSIONS) as Array<{ session_id: string }>;
      const remove = db.prepare('DELETE FROM sessions WHERE session_id = ?');
      for (const extra of extras) remove.run(extra.session_id);
    },
    close() {
      db.close();
    },
  };
}

export function newSourceId(): string {
  return `src_${crypto.randomBytes(6).toString('hex')}`;
}

export function newSessionId(): string {
  return `rs_${crypto.randomBytes(6).toString('hex')}`;
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/gu, ' ');
}

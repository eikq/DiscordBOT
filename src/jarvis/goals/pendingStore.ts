import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { defaultRuntimeRoot, openOperationalSqlite } from '../storage/operationalDb';
import { looksLikeSecret } from '../security/redaction';
import { validateAdapterAuthorityBoundary } from './schema';
import { PENDING_GOAL_STATES, type PendingGoalRecord, type PendingGoalState } from './pendingTypes';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pending_goals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  state TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pending_goals_session_state
  ON pending_goals(session_id, state, expires_at);
`;

export const DEFAULT_PENDING_GOAL_TTL_MS = 15 * 60_000;

export type PendingGoalStoreOptions = {
  now?: () => number;
  ttlMs?: number;
  dbPath?: string;
};

export function defaultPendingGoalDbPath(workspaceRoot = process.cwd()): string {
  return path.join(defaultRuntimeRoot(workspaceRoot), 'pending-goals.db');
}

export function newPendingGoalId(): string {
  return `pending_${randomBytes(16).toString('hex')}`;
}

export class PendingGoalStore {
  private readonly records = new Map<string, PendingGoalRecord>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly db?: DatabaseSync;

  constructor(options: PendingGoalStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = Math.max(60_000, Math.min(options.ttlMs ?? DEFAULT_PENDING_GOAL_TTL_MS, 24 * 60 * 60_000));
    if (options.dbPath) {
      const opened = openOperationalSqlite(options.dbPath, 'Pending goal store');
      this.db = opened.db;
      this.db.exec(SCHEMA);
      const rows = this.db.prepare('SELECT payload FROM pending_goals ORDER BY updated_at ASC').all() as Array<{ payload: string }>;
      for (const row of rows) {
        try {
          const parsed = safeRecord(JSON.parse(String(row.payload)));
          if (parsed) this.records.set(parsed.pendingGoalId, parsed);
        } catch {
          // Corrupt persisted context is ignored; it can never become execution authority.
        }
      }
    }
  }

  public create(input: Omit<PendingGoalRecord, 'pendingGoalId' | 'createdAt' | 'updatedAt' | 'expiresAt' | 'state' | 'revision'> & {
    ttlMs?: number;
  }): PendingGoalRecord {
    const authority = validateAdapterAuthorityBoundary(input.validatedInputs);
    if (authority.ok === false) throw new Error('Pending goal inputs contain authority-bearing or secret material.');
    if (looksLikeSecret(input.originalOwnerIntent)) throw new Error('Pending goal intent contains secret material.');
    const at = this.now();
    const record: PendingGoalRecord = {
      ...structuredClone(input),
      pendingGoalId: newPendingGoalId(),
      createdAt: new Date(at).toISOString(),
      updatedAt: new Date(at).toISOString(),
      expiresAt: new Date(at + Math.max(60_000, Math.min(input.ttlMs ?? this.ttlMs, 24 * 60 * 60_000))).toISOString(),
      state: 'WAITING_OWNER_INPUT',
      revision: 0,
    };
    delete (record as PendingGoalRecord & { ttlMs?: number }).ttlMs;
    this.records.set(record.pendingGoalId, record);
    this.write(record);
    return clone(record);
  }

  public get(id: string): PendingGoalRecord | undefined {
    const record = this.records.get(id);
    if (!record) return undefined;
    this.expire(record);
    return clone(record);
  }

  public list(sessionId?: string): PendingGoalRecord[] {
    const records = [...this.records.values()];
    records.forEach(record => this.expire(record));
    return records
      .filter(record => !sessionId || record.sessionId === sessionId)
      .map(clone);
  }

  public waiting(sessionId: string): PendingGoalRecord[] {
    return this.list(sessionId).filter(record => record.state === 'WAITING_OWNER_INPUT' || record.state === 'READY_TO_RESUME');
  }

  public save(record: PendingGoalRecord): PendingGoalRecord {
    const current = this.records.get(record.pendingGoalId);
    if (!current) throw new Error('Unknown pending goal.');
    const authority = validateAdapterAuthorityBoundary(record.validatedInputs);
    if (authority.ok === false) throw new Error('Pending goal inputs contain authority-bearing or secret material.');
    if (looksLikeSecret(record.originalOwnerIntent)) throw new Error('Pending goal intent contains secret material.');
    if (record.resolvedGoal && validateAdapterAuthorityBoundary(record.resolvedGoal.extractedInputs).ok === false) {
      throw new Error('Pending goal resolution contains authority-bearing or secret material.');
    }
    const next = clone({ ...record, updatedAt: new Date(this.now()).toISOString() });
    this.records.set(next.pendingGoalId, next);
    this.write(next);
    return clone(next);
  }

  public setState(id: string, state: PendingGoalState): PendingGoalRecord {
    const record = this.get(id);
    if (!record) throw new Error('Unknown pending goal.');
    record.state = state;
    return this.save(record);
  }

  public close(): void {
    this.db?.close();
  }

  private expire(record: PendingGoalRecord): void {
    if ((record.state === 'WAITING_OWNER_INPUT' || record.state === 'READY_TO_RESUME') && Date.parse(record.expiresAt) <= this.now()) {
      record.state = 'EXPIRED';
      record.updatedAt = new Date(this.now()).toISOString();
      this.write(record);
    }
  }

  private write(record: PendingGoalRecord): void {
    this.db?.prepare(`
      INSERT INTO pending_goals(id, session_id, goal_id, state, expires_at, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        session_id = excluded.session_id,
        goal_id = excluded.goal_id,
        state = excluded.state,
        expires_at = excluded.expires_at,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(
      record.pendingGoalId,
      record.sessionId,
      record.goalId,
      record.state,
      record.expiresAt,
      JSON.stringify(record),
      record.createdAt,
      record.updatedAt,
    );
  }
}

function safeRecord(value: unknown): PendingGoalRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as PendingGoalRecord;
  if (!/^pending_[a-f0-9]{32}$/u.test(String(record.pendingGoalId || ''))) return undefined;
  if (typeof record.sessionId !== 'string' || !record.sessionId.trim() || record.sessionId.length > 200) return undefined;
  if (typeof record.goalId !== 'string' || !record.goalId.trim() || record.goalId.length > 160) return undefined;
  if (!Number.isInteger(record.goalVersion) || record.goalVersion < 1) return undefined;
  if (!PENDING_GOAL_STATES.includes(record.state)) return undefined;
  if (![record.createdAt, record.updatedAt, record.expiresAt].every(item => typeof item === 'string' && Number.isFinite(Date.parse(item)))) return undefined;
  if (typeof record.originalOwnerIntent !== 'string' || looksLikeSecret(record.originalOwnerIntent)) return undefined;
  if (!Array.isArray(record.missingFields) || !record.missingFields.every(item => typeof item === 'string')) return undefined;
  if (!Array.isArray(record.evidence) || !record.evidence.every(item => typeof item === 'string')) return undefined;
  if (!Number.isInteger(record.revision) || record.revision < 0) return undefined;
  if (record.continuationReceipts && (
    record.continuationReceipts.length > 8
    || !record.continuationReceipts.every(item => /^[a-f0-9]{64}$/u.test(item))
  )) return undefined;
  if (!record.validatedInputs || typeof record.validatedInputs !== 'object' || Array.isArray(record.validatedInputs)) return undefined;
  if (validateAdapterAuthorityBoundary(record.validatedInputs).ok === false) return undefined;
  if (record.resolvedGoal && validateAdapterAuthorityBoundary(record.resolvedGoal.extractedInputs).ok === false) return undefined;
  return clone(record);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

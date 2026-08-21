import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { defaultRuntimeRoot, openOperationalSqlite } from '../storage/operationalDb';
import { assertPersistableJournalValue, journalError } from './fingerprints';
import {
  EXECUTION_JOURNAL_STATES,
  JOURNAL_ACTIVE_STATES,
  JOURNAL_OPERATION_ID_PATTERN,
  JOURNAL_SCHEMA_VERSION,
  type ExecutionJournalRecord,
  type ExecutionJournalState,
  type JournalIdempotencyClass,
  type JournalVerificationState,
  type RecoveryDisposition,
} from './types';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS execution_journal (
  operation_id TEXT PRIMARY KEY,
  capability_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  execution_state TEXT NOT NULL,
  verification_state TEXT NOT NULL,
  idempotency_class TEXT NOT NULL,
  idempotency_identity TEXT,
  action_fingerprint TEXT NOT NULL,
  scope_fingerprint TEXT NOT NULL,
  checkpoint_id TEXT,
  parent_operation_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  schema_version INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_journal_idempotency
  ON execution_journal(capability_id, idempotency_identity)
  WHERE idempotency_identity IS NOT NULL AND idempotency_identity != '';
CREATE INDEX IF NOT EXISTS idx_execution_journal_active
  ON execution_journal(execution_state, updated_at);
CREATE INDEX IF NOT EXISTS idx_execution_journal_checkpoint
  ON execution_journal(checkpoint_id);
`;

export type ExecutionJournalStoreOptions = {
  dbPath?: string;
  now?: () => number;
};

export function defaultExecutionJournalDbPath(workspaceRoot = process.cwd()): string {
  return path.join(defaultRuntimeRoot(workspaceRoot), 'execution-journal.db');
}

export class ExecutionJournalStore {
  public failClosed = false;
  public failClosedReason?: string;
  private readonly records = new Map<string, ExecutionJournalRecord>();
  private readonly dbPath?: string;
  private readonly now: () => number;

  public constructor(options: ExecutionJournalStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    if (!options.dbPath) return;
    this.dbPath = options.dbPath;
    this.load();
  }

  public get(operationId: string): ExecutionJournalRecord | undefined {
    const record = this.records.get(operationId);
    return record ? clone(record) : undefined;
  }

  public list(): ExecutionJournalRecord[] {
    return [...this.records.values()].map(clone);
  }

  public active(): ExecutionJournalRecord[] {
    return this.list().filter(record => JOURNAL_ACTIVE_STATES.includes(record.executionState));
  }

  public findByIdempotency(capabilityId: string, identity: string): ExecutionJournalRecord | undefined {
    return this.list().find(record => record.capabilityId === capabilityId && record.idempotencyIdentity === identity);
  }

  public findByCheckpoint(checkpointId: string): ExecutionJournalRecord[] {
    return this.list().filter(record => record.checkpointId === checkpointId);
  }

  public put(record: ExecutionJournalRecord): ExecutionJournalRecord {
    if (this.failClosed) {
      throw journalError('JOURNAL_FAIL_CLOSED', this.failClosedReason || 'Execution journal is fail-closed.');
    }
    if (!validRecord(record)) {
      throw journalError('JOURNAL_SCHEMA_INVALID', 'Journal record failed schema validation.');
    }
    assertPersistableJournalValue(record, 'journal record');
    const existing = this.records.get(record.operationId);
    if (existing && existing.idempotencyIdentity && record.idempotencyIdentity
      && existing.idempotencyIdentity !== record.idempotencyIdentity) {
      throw journalError('JOURNAL_IDEMPOTENCY_CONFLICT', 'Idempotency identity cannot change for an operation.');
    }
    if (record.idempotencyIdentity) {
      const duplicate = this.findByIdempotency(record.capabilityId, record.idempotencyIdentity);
      if (duplicate && duplicate.operationId !== record.operationId) {
        throw journalError(
          'JOURNAL_IDEMPOTENCY_CONFLICT',
          'Duplicate idempotency identity cannot create a second mutating operation.',
        );
      }
    }
    this.records.set(record.operationId, clone(record));
    this.persist(record);
    return clone(record);
  }

  private persist(record: ExecutionJournalRecord): void {
    if (!this.dbPath) return;
    try {
      this.withDb(db => {
        db.prepare(`
          INSERT INTO execution_journal (
            operation_id, capability_id, kind, execution_state, verification_state,
            idempotency_class, idempotency_identity, action_fingerprint, scope_fingerprint,
            checkpoint_id, parent_operation_id, payload, created_at, updated_at, schema_version
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(operation_id) DO UPDATE SET
            execution_state = excluded.execution_state,
            verification_state = excluded.verification_state,
            checkpoint_id = excluded.checkpoint_id,
            parent_operation_id = excluded.parent_operation_id,
            payload = excluded.payload,
            updated_at = excluded.updated_at
        `).run(
          record.operationId,
          record.capabilityId,
          record.kind,
          record.executionState,
          record.verificationState,
          record.idempotencyClass,
          record.idempotencyIdentity ?? null,
          record.actionFingerprint,
          record.scopeFingerprint,
          record.checkpointId ?? null,
          record.parentOperationId ?? null,
          JSON.stringify(record),
          record.createdAt,
          record.updatedAt,
          JOURNAL_SCHEMA_VERSION,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE/iu.test(message)) {
        throw journalError('JOURNAL_IDEMPOTENCY_CONFLICT', 'Duplicate idempotency identity rejected.');
      }
      throw error;
    }
  }

  private load(): void {
    if (!this.dbPath) return;
    let rows: Array<{ payload: string; schema_version: number }>;
    try {
      rows = this.withDb(db => db.prepare('SELECT payload, schema_version FROM execution_journal ORDER BY updated_at ASC').all() as Array<{
        payload: string;
        schema_version: number;
      }>);
    } catch {
      this.enterFailClosed('Persistent execution journal could not be read safely.');
      return;
    }
    for (const row of rows) {
      let parsed: unknown;
      try {
        if (Number(row.schema_version) !== JOURNAL_SCHEMA_VERSION) {
          throw new Error('Unsupported journal schema version.');
        }
        parsed = JSON.parse(String(row.payload));
      } catch {
        this.enterFailClosed('Persistent execution journal payload is corrupt.');
        this.records.clear();
        return;
      }
      if (!validRecord(parsed)) {
        const maybe = parsed as { executionState?: string };
        if (maybe && JOURNAL_ACTIVE_STATES.includes(maybe.executionState as ExecutionJournalState)) {
          this.enterFailClosed('An active journal record failed schema validation.');
          this.records.clear();
          return;
        }
        continue;
      }
      this.records.set(parsed.operationId, parsed);
    }
  }

  private withDb<T>(fn: (db: DatabaseSync) => T): T {
    const opened = openOperationalSqlite(this.dbPath!, 'Execution journal');
    try {
      opened.db.exec(SCHEMA);
      return fn(opened.db);
    } finally {
      opened.db.close();
    }
  }

  private enterFailClosed(reason: string): void {
    this.failClosed = true;
    this.failClosedReason = reason;
  }
}

export function validRecord(value: unknown): value is ExecutionJournalRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<ExecutionJournalRecord>;
  return typeof item.operationId === 'string'
    && JOURNAL_OPERATION_ID_PATTERN.test(item.operationId)
    && typeof item.capabilityId === 'string'
    && item.capabilityId.length > 0
    && (item.kind === 'MUTATION' || item.kind === 'ROLLBACK')
    && typeof item.actionFingerprint === 'string'
    && item.actionFingerprint.length === 64
    && typeof item.scopeFingerprint === 'string'
    && item.scopeFingerprint.length === 64
    && isIdempotencyClass(item.idempotencyClass)
    && EXECUTION_JOURNAL_STATES.includes(item.executionState as ExecutionJournalState)
    && isVerificationState(item.verificationState)
    && Array.isArray(item.evidenceRefs)
    && item.evidenceRefs.every(entry => typeof entry === 'string')
    && typeof item.createdAt === 'string'
    && typeof item.updatedAt === 'string'
    && isDisposition(item.recoveryDisposition)
    && (item.idempotencyIdentity === undefined || typeof item.idempotencyIdentity === 'string')
    && (item.checkpointId === undefined || typeof item.checkpointId === 'string')
    && (item.parentOperationId === undefined || typeof item.parentOperationId === 'string');
}

function isIdempotencyClass(value: unknown): value is JournalIdempotencyClass {
  return value === 'IDEMPOTENT' || value === 'NON_IDEMPOTENT' || value === 'UNKNOWN';
}

function isVerificationState(value: unknown): value is JournalVerificationState {
  return value === 'NOT_STARTED'
    || value === 'UNVERIFIED'
    || value === 'VERIFIED'
    || value === 'PARTIALLY_VERIFIED'
    || value === 'FAILED_VERIFICATION'
    || value === 'NOT_APPLICABLE';
}

function isDisposition(value: unknown): value is RecoveryDisposition {
  return value === 'NONE'
    || value === 'RETRY_OFFERED'
    || value === 'VERIFY_ONLY'
    || value === 'OWNER_REVIEW'
    || value === 'CONTAINED'
    || value === 'ROLLBACK_AVAILABLE'
    || value === 'INTERRUPTED_BEFORE_COMMIT'
    || value === 'EMERGENCY_STOP'
    || value === 'STEP_VERIFIED_GOAL_OPEN';
}

function clone(record: ExecutionJournalRecord): ExecutionJournalRecord {
  return {
    ...record,
    evidenceRefs: [...record.evidenceRefs],
  };
}

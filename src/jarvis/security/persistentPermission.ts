import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { looksLikeSecret, redactDeep } from './redaction';
import { defaultRuntimeRoot, openOperationalSqlite } from '../storage/operationalDb';
import { sandboxPathFor } from '../build/sandbox';
import type { BuildPlan } from '../build/types';
import type { PermissionDuration, PermissionEffect, PermissionProposal } from './permissionProposal';
import type { PrivilegeLease } from './types';

export const PERMISSION_POLICY_REVISION = 'persistent-builder-v1';

export const PERSISTENT_PERMISSION_STATUSES = [
  'PENDING',
  'GRANTED',
  'ACTIVE',
  'EXPIRED',
  'DENIED',
  'REVOKED',
  'INVALID_AFTER_RESTART',
  'NEEDS_REAPPROVAL',
] as const;

export type PersistentPermissionStatus = (typeof PERSISTENT_PERMISSION_STATUSES)[number];

export type OwnerDecisionSource = 'voice' | 'text' | 'ui_action';

export type PersistentPermissionRecord = {
  id: string;
  kind: 'proposal' | 'lease';
  status: PersistentPermissionStatus;
  goalId?: string;
  planId?: string;
  sessionId?: string;
  capabilityId: string;
  capabilityIds: string[];
  target: string;
  effects: PermissionEffect[];
  grantMode: PermissionDuration;
  createdAt: number;
  expiresAt: number;
  ownerDecision?: 'granted' | 'denied';
  ownerSource?: OwnerDecisionSource;
  proposalId: string;
  leaseId?: string;
  argumentsHash: string;
  normalizedArguments: Record<string, unknown>;
  displayName: string;
  summary: string;
  revision: number;
  policyFingerprint: string;
  remainingActions?: number;
  maxActions?: number;
  resourceScopes: string[];
  revalidationReason?: string;
  permissionProposal?: PermissionProposal;
  updatedAt: number;
};

export type RevalidationContext = {
  now: number;
  policyRevision: string;
  currentEffects: PermissionEffect[];
  plan?: BuildPlan | null;
  capabilityAvailable: (id: string) => boolean;
  targetAllowed: (target: string) => boolean;
};

export function permissionPolicyFingerprint(input: {
  capabilityId: string;
  effects: readonly string[];
  target: string;
  grantMode: string;
  revision?: string;
}): string {
  const payload = [
    input.revision || PERMISSION_POLICY_REVISION,
    input.capabilityId,
    input.grantMode,
    input.target,
    [...input.effects].sort().join(','),
  ].join('|');
  return createHash('sha256').update(payload).digest('hex');
}

export function defaultPersistentPermissionPath(runtimeRoot = defaultRuntimeRoot()): string {
  return path.join(runtimeRoot, 'permissions.db');
}

export class PersistentPermissionStore {
  private readonly dbPath: string;

  constructor(options: { dbPath?: string; now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now());
    this.dbPath = options.dbPath ?? defaultPersistentPermissionPath();
    this.ensureSchema();
  }

  public save(record: PersistentPermissionRecord): PersistentPermissionRecord {
    const next = sanitizeRecord({ ...record, updatedAt: this.now() });
    return this.withDb(db => {
      db.prepare(`
        INSERT INTO permission_records (
          id, kind, status, goal_id, plan_id, session_id, capability_id, capability_ids,
          target, effects, grant_mode, created_at, expires_at, owner_decision, owner_source,
          proposal_id, lease_id, arguments_hash, normalized_arguments, display_name, summary,
          revision, policy_fingerprint, remaining_actions, max_actions, resource_scopes,
          revalidation_reason, permission_proposal, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          kind = excluded.kind,
          status = excluded.status,
          goal_id = excluded.goal_id,
          plan_id = excluded.plan_id,
          session_id = excluded.session_id,
          capability_id = excluded.capability_id,
          capability_ids = excluded.capability_ids,
          target = excluded.target,
          effects = excluded.effects,
          grant_mode = excluded.grant_mode,
          created_at = excluded.created_at,
          expires_at = excluded.expires_at,
          owner_decision = excluded.owner_decision,
          owner_source = excluded.owner_source,
          proposal_id = excluded.proposal_id,
          lease_id = excluded.lease_id,
          arguments_hash = excluded.arguments_hash,
          normalized_arguments = excluded.normalized_arguments,
          display_name = excluded.display_name,
          summary = excluded.summary,
          revision = excluded.revision,
          policy_fingerprint = excluded.policy_fingerprint,
          remaining_actions = excluded.remaining_actions,
          max_actions = excluded.max_actions,
          resource_scopes = excluded.resource_scopes,
          revalidation_reason = excluded.revalidation_reason,
          permission_proposal = excluded.permission_proposal,
          updated_at = excluded.updated_at
      `).run(
        next.id,
        next.kind,
        next.status,
        next.goalId ?? null,
        next.planId ?? null,
        next.sessionId ?? null,
        next.capabilityId,
        JSON.stringify(next.capabilityIds),
        next.target,
        JSON.stringify(next.effects),
        next.grantMode,
        next.createdAt,
        next.expiresAt,
        next.ownerDecision ?? null,
        next.ownerSource ?? null,
        next.proposalId,
        next.leaseId ?? null,
        next.argumentsHash,
        JSON.stringify(next.normalizedArguments),
        next.displayName,
        next.summary,
        next.revision,
        next.policyFingerprint,
        next.remainingActions ?? null,
        next.maxActions ?? null,
        JSON.stringify(next.resourceScopes),
        next.revalidationReason ?? null,
        next.permissionProposal ? JSON.stringify(next.permissionProposal) : null,
        next.updatedAt,
      );
      return next;
    });
  }

  public get(id: string): PersistentPermissionRecord | null {
    return this.withDb(db => {
      const row = db.prepare('SELECT * FROM permission_records WHERE id = ?').get(id);
      return row ? mapRecord(row as Record<string, unknown>) : null;
    });
  }

  public getByProposal(proposalId: string): PersistentPermissionRecord | null {
    return this.withDb(db => {
      const row = db.prepare(
        'SELECT * FROM permission_records WHERE proposal_id = ? ORDER BY updated_at DESC LIMIT 1',
      ).get(proposalId);
      return row ? mapRecord(row as Record<string, unknown>) : null;
    });
  }

  public list(status?: PersistentPermissionStatus): PersistentPermissionRecord[] {
    return this.withDb(db => {
      const rows = status
        ? db.prepare('SELECT * FROM permission_records WHERE status = ? ORDER BY updated_at DESC').all(status)
        : db.prepare('SELECT * FROM permission_records ORDER BY updated_at DESC').all();
      return rows.map(row => mapRecord(row as Record<string, unknown>));
    });
  }

  public latestPending(sessionId?: string): PersistentPermissionRecord | null {
    return this.withDb(db => {
      const row = sessionId
        ? db.prepare(
          `SELECT * FROM permission_records
           WHERE status = 'PENDING' AND (session_id IS NULL OR session_id = ?)
           ORDER BY updated_at DESC LIMIT 1`,
        ).get(sessionId)
        : db.prepare(
          `SELECT * FROM permission_records WHERE status = 'PENDING' ORDER BY updated_at DESC LIMIT 1`,
        ).get();
      return row ? mapRecord(row as Record<string, unknown>) : null;
    });
  }

  public latestActiveLease(goalId?: string, planId?: string): PersistentPermissionRecord | null {
    return this.withDb(db => {
      const row = db.prepare(
        `SELECT * FROM permission_records
         WHERE status = 'ACTIVE' AND kind = 'lease'
           AND (? IS NULL OR goal_id = ?)
           AND (? IS NULL OR plan_id = ?)
         ORDER BY updated_at DESC LIMIT 1`,
      ).get(goalId ?? null, goalId ?? null, planId ?? null, planId ?? null);
      return row ? mapRecord(row as Record<string, unknown>) : null;
    });
  }

  public close(): void {
    // Connections are opened per operation so Windows tests can delete the temp runtime dir.
  }

  private ensureSchema(): void {
    this.withDb(db => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS permission_records (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          goal_id TEXT,
          plan_id TEXT,
          session_id TEXT,
          capability_id TEXT NOT NULL,
          capability_ids TEXT NOT NULL,
          target TEXT NOT NULL,
          effects TEXT NOT NULL,
          grant_mode TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          owner_decision TEXT,
          owner_source TEXT,
          proposal_id TEXT NOT NULL,
          lease_id TEXT,
          arguments_hash TEXT NOT NULL,
          normalized_arguments TEXT NOT NULL,
          display_name TEXT NOT NULL,
          summary TEXT NOT NULL,
          revision INTEGER NOT NULL,
          policy_fingerprint TEXT NOT NULL,
          remaining_actions INTEGER,
          max_actions INTEGER,
          resource_scopes TEXT NOT NULL,
          revalidation_reason TEXT,
          permission_proposal TEXT,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_permission_status ON permission_records(status);
        CREATE INDEX IF NOT EXISTS idx_permission_proposal ON permission_records(proposal_id);
      `);
    });
  }

  private withDb<T>(fn: (db: DatabaseSync) => T): T {
    const { db } = openOperationalSqlite(this.dbPath, 'permission-state');
    try {
      return fn(db);
    } finally {
      db.close();
    }
  }

  private readonly now: () => number;
}

export function createPendingPermissionRecord(input: {
  proposalId: string;
  capabilityId: string;
  capabilityIds?: string[];
  displayName: string;
  summary: string;
  target: string;
  argumentsHash: string;
  normalizedArguments: Record<string, unknown>;
  effects: PermissionEffect[];
  grantMode: PermissionDuration;
  goalId?: string;
  planId?: string;
  sessionId?: string;
  expiresAt: number;
  permissionProposal?: PermissionProposal;
  resourceScopes?: string[];
  now?: number;
}): PersistentPermissionRecord {
  const createdAt = input.now ?? Date.now();
  return sanitizeRecord({
    id: input.proposalId,
    kind: 'proposal',
    status: 'PENDING',
    goalId: input.goalId,
    planId: input.planId,
    sessionId: input.sessionId,
    capabilityId: input.capabilityId,
    capabilityIds: input.capabilityIds?.length ? input.capabilityIds : [input.capabilityId],
    target: input.target,
    effects: input.effects,
    grantMode: input.grantMode,
    createdAt,
    expiresAt: input.expiresAt,
    proposalId: input.proposalId,
    argumentsHash: input.argumentsHash,
    normalizedArguments: input.normalizedArguments,
    displayName: input.displayName,
    summary: input.summary,
    revision: 1,
    policyFingerprint: permissionPolicyFingerprint({
      capabilityId: input.capabilityId,
      effects: input.effects,
      target: input.target,
      grantMode: input.grantMode,
    }),
    resourceScopes: input.resourceScopes?.length ? input.resourceScopes : [input.target],
    permissionProposal: input.permissionProposal,
    updatedAt: createdAt,
  });
}

export function applyOwnerDecision(
  record: PersistentPermissionRecord,
  input: {
    decision: 'granted' | 'denied';
    source: OwnerDecisionSource;
    lease?: PrivilegeLease;
    now?: number;
  },
): PersistentPermissionRecord {
  const now = input.now ?? Date.now();
  if (input.decision === 'denied') {
    return {
      ...record,
      status: 'DENIED',
      ownerDecision: 'denied',
      ownerSource: input.source,
      updatedAt: now,
      revision: record.revision + 1,
    };
  }
  if (record.grantMode === 'ONCE' || !input.lease) {
    return {
      ...record,
      kind: 'proposal',
      status: 'GRANTED',
      ownerDecision: 'granted',
      ownerSource: input.source,
      leaseId: input.lease?.id,
      updatedAt: now,
      revision: record.revision + 1,
    };
  }
  return {
    ...record,
    kind: 'lease',
    status: 'ACTIVE',
    ownerDecision: 'granted',
    ownerSource: input.source,
    leaseId: input.lease.id,
    capabilityIds: [...input.lease.capabilityIds],
    resourceScopes: [...input.lease.resourceScopes],
    remainingActions: input.lease.remainingActions,
    maxActions: input.lease.maxActions,
    expiresAt: Date.parse(input.lease.expiresAt) || record.expiresAt,
    updatedAt: now,
    revision: record.revision + 1,
  };
}

export function revalidatePermissionRecord(
  record: PersistentPermissionRecord,
  ctx: RevalidationContext,
): { record: PersistentPermissionRecord; restored: boolean } {
  if (record.status === 'DENIED' || record.status === 'REVOKED') {
    return { record, restored: false };
  }
  if (record.status === 'GRANTED' && record.grantMode === 'ONCE') {
    return { record, restored: false };
  }
  if (record.expiresAt <= ctx.now) {
    return {
      record: withStatus(record, 'EXPIRED', 'Lease or proposal expired.', ctx.now),
      restored: false,
    };
  }
  const expected = permissionPolicyFingerprint({
    capabilityId: record.capabilityId,
    effects: ctx.currentEffects,
    target: record.target,
    grantMode: record.grantMode,
    revision: ctx.policyRevision,
  });
  if (record.policyFingerprint !== expected) {
    return {
      record: withStatus(record, 'NEEDS_REAPPROVAL', 'Current permission policy no longer matches the persisted grant.', ctx.now),
      restored: false,
    };
  }
  if (!record.capabilityIds.every(id => ctx.capabilityAvailable(id))) {
    return {
      record: withStatus(record, 'INVALID_AFTER_RESTART', 'A persisted capability is no longer available.', ctx.now),
      restored: false,
    };
  }
  if (!ctx.targetAllowed(record.target)) {
    return {
      record: withStatus(record, 'INVALID_AFTER_RESTART', 'Persisted target is no longer inside the authorized sandbox.', ctx.now),
      restored: false,
    };
  }
  if (record.grantMode === 'THIS_GOAL') {
    if (!ctx.plan || ctx.plan.id !== record.planId) {
      return {
        record: withStatus(record, 'INVALID_AFTER_RESTART', 'Goal-scoped grant no longer matches the current plan.', ctx.now),
        restored: false,
      };
    }
    if (record.goalId && ctx.plan.goalId !== record.goalId) {
      return {
        record: withStatus(record, 'INVALID_AFTER_RESTART', 'Persisted goal id does not match the current plan.', ctx.now),
        restored: false,
      };
    }
  }
  if (record.effects.some(effect => !ctx.currentEffects.includes(effect))) {
    return {
      record: withStatus(record, 'INVALID_AFTER_RESTART', 'Persisted effects are no longer allowed by policy.', ctx.now),
      restored: false,
    };
  }
  if (record.status === 'PENDING') {
    return { record, restored: true };
  }
  if (record.status === 'ACTIVE' || record.status === 'GRANTED') {
    return {
      record: { ...record, status: 'ACTIVE', revalidationReason: undefined, updatedAt: ctx.now },
      restored: true,
    };
  }
  return { record, restored: false };
}

export function leaseFromPermission(record: PersistentPermissionRecord): PrivilegeLease | undefined {
  if (!record.leaseId || record.status !== 'ACTIVE') return undefined;
  return {
    id: record.leaseId,
    issuedAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    capabilityIds: [...record.capabilityIds],
    resourceScopes: [...record.resourceScopes],
    maxActions: record.maxActions ?? 32,
    remainingActions: record.remainingActions ?? record.maxActions ?? 32,
    reason: record.summary.slice(0, 200),
    ownerApproved: true,
    taskId: record.goalId,
    stepId: record.planId,
    approvalProvenance: {
      actor: 'owner',
      approvedAt: new Date(record.updatedAt).toISOString(),
      proposalId: record.proposalId,
    },
  };
}

export function buildSandboxTargetAllowed(root?: string): (target: string) => boolean {
  return (target: string) => {
    const trimmed = target.trim();
    if (!trimmed || trimmed.includes('..') || looksLikeSecret(trimmed)) return false;
    const relative = trimmed.replace(/\\/gu, '/');
    const match = /(?:^|\/)data\/jarvis\/builds\/([^/]+)\/?$/u.exec(relative)
      || /^[a-zA-Z0-9._-]{1,40}$/u.exec(trimmed);
    if (!match) return false;
    const slug = (match[1] || match[0] || '').replace(/^data\/jarvis\/builds\//u, '');
    try {
      sandboxPathFor(slug, root);
      return true;
    } catch {
      return false;
    }
  };
}

function withStatus(
  record: PersistentPermissionRecord,
  status: PersistentPermissionStatus,
  reason: string,
  now: number,
): PersistentPermissionRecord {
  return {
    ...record,
    status,
    revalidationReason: reason,
    updatedAt: now,
    revision: record.revision + 1,
  };
}

function sanitizeRecord(record: PersistentPermissionRecord): PersistentPermissionRecord {
  const args = redactDeep(record.normalizedArguments) as Record<string, unknown>;
  if (looksLikeSecret(record.summary) || looksLikeSecret(record.displayName) || looksLikeSecret(record.target)) {
    throw new Error('Permission records cannot contain secret material.');
  }
  return {
    ...record,
    id: record.id || `perm_${randomUUID()}`,
    normalizedArguments: args,
    summary: record.summary.slice(0, 240),
    displayName: record.displayName.slice(0, 160),
    target: record.target.slice(0, 240),
  };
}

function mapRecord(row: Record<string, unknown>): PersistentPermissionRecord {
  return {
    id: String(row.id),
    kind: row.kind === 'lease' ? 'lease' : 'proposal',
    status: asStatus(String(row.status)),
    goalId: row.goal_id ? String(row.goal_id) : undefined,
    planId: row.plan_id ? String(row.plan_id) : undefined,
    sessionId: row.session_id ? String(row.session_id) : undefined,
    capabilityId: String(row.capability_id),
    capabilityIds: parseStringArray(row.capability_ids),
    target: String(row.target),
    effects: parseStringArray(row.effects) as PermissionEffect[],
    grantMode: row.grant_mode === 'ONCE' ? 'ONCE' : 'THIS_GOAL',
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    ownerDecision: row.owner_decision === 'denied' || row.owner_decision === 'granted'
      ? row.owner_decision
      : undefined,
    ownerSource: asSource(row.owner_source),
    proposalId: String(row.proposal_id),
    leaseId: row.lease_id ? String(row.lease_id) : undefined,
    argumentsHash: String(row.arguments_hash),
    normalizedArguments: parseObject(row.normalized_arguments),
    displayName: String(row.display_name),
    summary: String(row.summary),
    revision: Number(row.revision) || 1,
    policyFingerprint: String(row.policy_fingerprint),
    remainingActions: row.remaining_actions == null ? undefined : Number(row.remaining_actions),
    maxActions: row.max_actions == null ? undefined : Number(row.max_actions),
    resourceScopes: parseStringArray(row.resource_scopes),
    revalidationReason: row.revalidation_reason ? String(row.revalidation_reason) : undefined,
    permissionProposal: row.permission_proposal
      ? parseObject(row.permission_proposal) as unknown as PermissionProposal
      : undefined,
    updatedAt: Number(row.updated_at),
  };
}

function asStatus(value: string): PersistentPermissionStatus {
  return (PERSISTENT_PERMISSION_STATUSES as readonly string[]).includes(value)
    ? value as PersistentPermissionStatus
    : 'INVALID_AFTER_RESTART';
}

function asSource(value: unknown): OwnerDecisionSource | undefined {
  return value === 'voice' || value === 'text' || value === 'ui_action' ? value : undefined;
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item));
  try {
    const parsed = JSON.parse(String(value || '[]')) as unknown;
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : [];
  } catch {
    return [];
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || '{}')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

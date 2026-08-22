import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  ABSOLUTE_LEASE_MAX_ACTIONS,
  DEFAULT_LEASE_MAX_ACTIONS,
  DEFAULT_LEASE_TTL_MS,
  MAX_LEASE_TTL_MS,
  PRIVILEGE_LEASE_PREFIX,
  capabilityRequiresLease,
  isForbiddenGenericShell,
} from './constants';
import type {
  IssueLeaseInput,
  PrivilegeActor,
  PrivilegeDecision,
  PrivilegeLease,
  PrivilegeLeaseInventoryItem,
  PrivilegeLeaseState,
} from './types';
import type { JarvisEventBus } from './eventBus';
import { looksLikeSecret } from './redaction';

const OWNER_ACTORS = new Set<PrivilegeActor>(['owner']);

export type PrivilegeLeaseStoreOptions = {
  now?: () => number;
  persistPath?: string;
  events?: JarvisEventBus;
};

export class PrivilegeLeaseStore {
  private readonly leases = new Map<string, PrivilegeLease>();
  private readonly now: () => number;
  private issuanceSuspendedReason?: string;

  constructor(private readonly options: PrivilegeLeaseStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    if (options.persistPath) this.load();
  }

  public issue(input: IssueLeaseInput, actor: PrivilegeActor): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor)) {
      return denied('SELF_APPROVAL_FORBIDDEN', 'Jarvis cannot approve or issue its own privilege lease.');
    }
    if (this.issuanceSuspendedReason) {
      return denied('LEASE_ISSUANCE_SUSPENDED', this.issuanceSuspendedReason);
    }
    if (input.ownerApproved === false) {
      return denied('OWNER_APPROVAL_REQUIRED', 'A privilege lease requires explicit owner approval.');
    }
    if (!input.capabilityIds.length) {
      return denied('INVALID_LEASE', 'A privilege lease must name at least one capability.');
    }
    if (input.capabilityIds.some(id => isForbiddenGenericShell(id))) {
      return denied('GENERIC_SHELL_FORBIDDEN', 'Generic unrestricted shell is not a Jarvis capability.');
    }
    if (!input.resourceScopes.length) {
      return denied('INVALID_LEASE', 'A privilege lease must name at least one resource scope.');
    }
    const reason = input.reason.trim();
    if (!reason || reason.length > 200) {
      return denied('INVALID_LEASE', 'A privilege lease needs a short owner reason.');
    }
    if (looksLikeSecret(reason) || input.resourceScopes.some(scope => looksLikeSecret(scope))) {
      return denied('SECRET_IN_LEASE', 'Privilege lease reason and scopes cannot contain secret material.');
    }
    const ttl = clamp(input.ttlMs ?? DEFAULT_LEASE_TTL_MS, 1_000, MAX_LEASE_TTL_MS);
    const maxActions = clamp(input.maxActions ?? DEFAULT_LEASE_MAX_ACTIONS, 1, ABSOLUTE_LEASE_MAX_ACTIONS);
    const issuedAt = this.now();
    const lease: PrivilegeLease = {
      id: `${PRIVILEGE_LEASE_PREFIX}${randomBytes(8).toString('hex')}`,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + ttl).toISOString(),
      capabilityIds: [...input.capabilityIds],
      resourceScopes: [...input.resourceScopes],
      maxActions,
      remainingActions: maxActions,
      reason,
      ownerApproved: true,
      ...(input.taskId ? { taskId: bounded(input.taskId, 120) } : {}),
      ...(input.stepId ? { stepId: bounded(input.stepId, 120) } : {}),
      ...(input.risk ? { risk: input.risk } : {}),
      approvalProvenance: {
        actor: 'owner',
        approvedAt: new Date(issuedAt).toISOString(),
        ...(input.approvalProvenance?.proposalId
          ? { proposalId: bounded(input.approvalProvenance.proposalId, 160) }
          : {}),
        ...(input.approvalProvenance?.requestId
          ? { requestId: bounded(input.approvalProvenance.requestId, 160) }
          : {}),
      },
    };
    this.leases.set(lease.id, lease);
    this.persist();
    this.options.events?.emit('LEASE_CREATED', 'Owner-approved temporary privilege lease created.', {
      leaseId: lease.id,
      capabilityIds: lease.capabilityIds,
      taskId: lease.taskId,
      stepId: lease.stepId,
      risk: lease.risk,
      expiresAt: lease.expiresAt,
      maxActions: lease.maxActions,
    });
    return { ok: true, lease: cloneLease(lease) };
  }

  public approve(id: string, actor: PrivilegeActor): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor)) {
      return denied('SELF_APPROVAL_FORBIDDEN', 'Jarvis cannot approve its own privilege lease.');
    }
    if (this.issuanceSuspendedReason) return denied('LEASE_ISSUANCE_SUSPENDED', this.issuanceSuspendedReason);
    const lease = this.leases.get(id);
    if (!lease) return denied('UNKNOWN_LEASE', 'That privilege lease does not exist.');
    lease.ownerApproved = true;
    this.persist();
    return { ok: true, lease: cloneLease(lease) };
  }

  public renew(id: string, actor: PrivilegeActor, ttlMs = DEFAULT_LEASE_TTL_MS): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor)) {
      return denied('SELF_RENEWAL_FORBIDDEN', 'Jarvis cannot renew its own privilege lease.');
    }
    if (this.issuanceSuspendedReason) return denied('LEASE_ISSUANCE_SUSPENDED', this.issuanceSuspendedReason);
    const lease = this.leases.get(id);
    if (!lease) return denied('UNKNOWN_LEASE', 'That privilege lease does not exist.');
    if (lease.revokedAt) return denied('LEASE_REVOKED', 'That privilege lease was revoked.');
    lease.expiresAt = new Date(this.now() + clamp(ttlMs, 1_000, MAX_LEASE_TTL_MS)).toISOString();
    this.persist();
    return { ok: true, lease: cloneLease(lease) };
  }

  public expand(
    id: string,
    actor: PrivilegeActor,
    extra: { capabilityIds?: string[]; resourceScopes?: string[] },
  ): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor)) {
      return denied('SELF_EXPAND_FORBIDDEN', 'Jarvis cannot expand its own privilege lease.');
    }
    if (this.issuanceSuspendedReason) return denied('LEASE_ISSUANCE_SUSPENDED', this.issuanceSuspendedReason);
    const lease = this.leases.get(id);
    if (!lease) return denied('UNKNOWN_LEASE', 'That privilege lease does not exist.');
    if (extra.capabilityIds?.some(item => isForbiddenGenericShell(item))) {
      return denied('GENERIC_SHELL_FORBIDDEN', 'Generic unrestricted shell is not a Jarvis capability.');
    }
    if (extra.resourceScopes?.some(scope => looksLikeSecret(scope))) {
      return denied('SECRET_IN_LEASE', 'Privilege lease scopes cannot contain secret material.');
    }
    if (extra.capabilityIds?.length) {
      lease.capabilityIds = unique([...lease.capabilityIds, ...extra.capabilityIds]);
    }
    if (extra.resourceScopes?.length) {
      lease.resourceScopes = unique([...lease.resourceScopes, ...extra.resourceScopes]);
    }
    this.persist();
    return { ok: true, lease: cloneLease(lease) };
  }

  public revoke(id: string, actor: PrivilegeActor): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor) && actor !== 'system') {
      return denied('REVOKE_FORBIDDEN', 'Only the owner can revoke a privilege lease.');
    }
    const lease = this.leases.get(id);
    if (!lease) return denied('UNKNOWN_LEASE', 'That privilege lease does not exist.');
    lease.revokedAt = new Date(this.now()).toISOString();
    this.persist();
    this.options.events?.emit('LEASE_REVOKED', 'Temporary privilege lease revoked.', {
      leaseId: lease.id,
      actor,
      taskId: lease.taskId,
      stepId: lease.stepId,
    });
    return { ok: true, lease: cloneLease(lease) };
  }

  public revokeAll(actor: PrivilegeActor): PrivilegeLeaseInventoryItem[] {
    if (!OWNER_ACTORS.has(actor) && actor !== 'system') return [];
    const revoked: PrivilegeLeaseInventoryItem[] = [];
    for (const lease of this.leases.values()) {
      if (leaseState(lease, this.now()) !== 'ACTIVE') continue;
      const result = this.revoke(lease.id, actor);
      if (!isPrivilegeDenied(result)) revoked.push(this.inventory(result.lease));
    }
    return revoked;
  }

  public suspendIssuance(reason: string): void {
    this.issuanceSuspendedReason = bounded(reason.trim() || 'Privilege lease issuance is suspended.', 240);
  }

  public resumeIssuance(actor: PrivilegeActor): boolean {
    if (!OWNER_ACTORS.has(actor)) return false;
    this.issuanceSuspendedReason = undefined;
    return true;
  }

  public issuanceSuspended(): boolean {
    return Boolean(this.issuanceSuspendedReason);
  }

  public peekValid(capabilityId: string, resourceScope?: string): PrivilegeDecision {
    return this.match(capabilityId, resourceScope, false);
  }

  public peekOptional(capabilityId: string, resourceScope?: string): PrivilegeDecision {
    return this.match(capabilityId, resourceScope, false, true);
  }

  public consume(capabilityId: string, resourceScope?: string): PrivilegeDecision {
    return this.match(capabilityId, resourceScope, true);
  }

  public restoreValidated(lease: PrivilegeLease): PrivilegeDecision {
    if (lease.capabilityIds.some(id => isForbiddenGenericShell(id))) {
      return denied('GENERIC_SHELL_FORBIDDEN', 'Generic unrestricted shell is not a Jarvis capability.');
    }
    if (!lease.ownerApproved || lease.revokedAt) {
      return denied('INVALID_AFTER_RESTART', 'Persisted lease is not owner-approved.');
    }
    this.leases.set(lease.id, cloneLease(lease));
    this.options.events?.emit('LEASE_REVALIDATED', 'Persisted privilege lease was revalidated after restart.', {
      leaseId: lease.id,
      capabilityIds: lease.capabilityIds,
      expiresAt: lease.expiresAt,
    });
    return { ok: true, lease: cloneLease(lease) };
  }

  public get(id: string): PrivilegeLease | undefined {
    const lease = this.leases.get(id);
    return lease ? cloneLease(lease) : undefined;
  }

  public list(): PrivilegeLease[] {
    return [...this.leases.values()].map(cloneLease);
  }

  public listInventory(): PrivilegeLeaseInventoryItem[] {
    return [...this.leases.values()].map(lease => this.inventory(lease));
  }

  private match(capabilityId: string, resourceScope: string | undefined, consume: boolean, optional = false): PrivilegeDecision {
    if (isForbiddenGenericShell(capabilityId)) {
      return denied('GENERIC_SHELL_FORBIDDEN', 'Generic unrestricted shell is not a Jarvis capability.');
    }
    if (this.issuanceSuspendedReason) {
      return denied('LEASE_ISSUANCE_SUSPENDED', this.issuanceSuspendedReason);
    }
    if (!optional && capabilityRequiresLease(capabilityId) === false && consume === false) {
      return denied('LEASE_NOT_REQUIRED', 'That capability does not use a privilege lease.');
    }
    const now = this.now();
    for (const lease of this.leases.values()) {
      if (!lease.ownerApproved) continue;
      if (lease.revokedAt) continue;
      if (Date.parse(lease.expiresAt) <= now) continue;
      if (lease.remainingActions <= 0) continue;
      if (!lease.capabilityIds.includes(capabilityId)) continue;
      if (resourceScope && !scopeAllows(lease.resourceScopes, resourceScope)) continue;
      if (consume) {
        lease.remainingActions -= 1;
        if (lease.remainingActions <= 0) lease.consumedAt = new Date(now).toISOString();
        this.persist();
      }
      return { ok: true, lease: cloneLease(lease) };
    }
    return denied('PRIVILEGE_DENIED', 'No valid owner-approved privilege lease covers that action.');
  }

  private load(): void {
    const file = this.options.persistPath;
    if (!file || !fs.existsSync(file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as PrivilegeLease[];
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (item?.id) this.leases.set(item.id, item);
      }
    } catch {
      // Fail closed to empty in-memory store rather than trusting a corrupt file.
    }
  }

  private persist(): void {
    const file = this.options.persistPath;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(this.list(), null, 2), 'utf8');
  }

  private inventory(lease: PrivilegeLease): PrivilegeLeaseInventoryItem {
    return { ...cloneLease(lease), state: leaseState(lease, this.now()) };
  }
}

function leaseState(lease: PrivilegeLease, now: number): PrivilegeLeaseState {
  if (lease.revokedAt) return 'REVOKED';
  if (lease.remainingActions <= 0) return 'CONSUMED';
  if (Date.parse(lease.expiresAt) <= now) return 'EXPIRED';
  return 'ACTIVE';
}

function cloneLease(lease: PrivilegeLease): PrivilegeLease {
  return {
    ...lease,
    capabilityIds: [...lease.capabilityIds],
    resourceScopes: [...lease.resourceScopes],
    ...(lease.approvalProvenance ? { approvalProvenance: { ...lease.approvalProvenance } } : {}),
  };
}

function bounded(value: string, max: number): string {
  return value.slice(0, max);
}

function scopeAllows(scopes: string[], resource: string): boolean {
  return scopes.some(scope => scope === '*' || scope === resource || resource.startsWith(`${scope}:`) || resource.startsWith(`${scope}/`));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function denied(reasonCode: string, userMessage: string): PrivilegeDecision {
  return { ok: false, reasonCode, userMessage };
}

export function isPrivilegeDenied(
  decision: PrivilegeDecision,
): decision is { ok: false; reasonCode: string; userMessage: string } {
  return decision.ok === false;
}

export function defaultPrivilegeLeasePath(): string {
  return path.join(process.cwd(), 'data', 'jarvis', 'security', 'leases.json');
}

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
import type { IssueLeaseInput, PrivilegeActor, PrivilegeDecision, PrivilegeLease } from './types';

const OWNER_ACTORS = new Set<PrivilegeActor>(['owner']);

export type PrivilegeLeaseStoreOptions = {
  now?: () => number;
  persistPath?: string;
};

export class PrivilegeLeaseStore {
  private readonly leases = new Map<string, PrivilegeLease>();
  private readonly now: () => number;

  constructor(private readonly options: PrivilegeLeaseStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    if (options.persistPath) this.load();
  }

  public issue(input: IssueLeaseInput, actor: PrivilegeActor): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor)) {
      return denied('SELF_APPROVAL_FORBIDDEN', 'Jarvis cannot approve or issue its own privilege lease.');
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
    };
    this.leases.set(lease.id, lease);
    this.persist();
    return { ok: true, lease: { ...lease } };
  }

  public approve(id: string, actor: PrivilegeActor): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor)) {
      return denied('SELF_APPROVAL_FORBIDDEN', 'Jarvis cannot approve its own privilege lease.');
    }
    const lease = this.leases.get(id);
    if (!lease) return denied('UNKNOWN_LEASE', 'That privilege lease does not exist.');
    lease.ownerApproved = true;
    this.persist();
    return { ok: true, lease: { ...lease } };
  }

  public renew(id: string, actor: PrivilegeActor, ttlMs = DEFAULT_LEASE_TTL_MS): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor)) {
      return denied('SELF_RENEWAL_FORBIDDEN', 'Jarvis cannot renew its own privilege lease.');
    }
    const lease = this.leases.get(id);
    if (!lease) return denied('UNKNOWN_LEASE', 'That privilege lease does not exist.');
    if (lease.revokedAt) return denied('LEASE_REVOKED', 'That privilege lease was revoked.');
    lease.expiresAt = new Date(this.now() + clamp(ttlMs, 1_000, MAX_LEASE_TTL_MS)).toISOString();
    this.persist();
    return { ok: true, lease: { ...lease } };
  }

  public expand(
    id: string,
    actor: PrivilegeActor,
    extra: { capabilityIds?: string[]; resourceScopes?: string[] },
  ): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor)) {
      return denied('SELF_EXPAND_FORBIDDEN', 'Jarvis cannot expand its own privilege lease.');
    }
    const lease = this.leases.get(id);
    if (!lease) return denied('UNKNOWN_LEASE', 'That privilege lease does not exist.');
    if (extra.capabilityIds?.some(item => isForbiddenGenericShell(item))) {
      return denied('GENERIC_SHELL_FORBIDDEN', 'Generic unrestricted shell is not a Jarvis capability.');
    }
    if (extra.capabilityIds?.length) {
      lease.capabilityIds = unique([...lease.capabilityIds, ...extra.capabilityIds]);
    }
    if (extra.resourceScopes?.length) {
      lease.resourceScopes = unique([...lease.resourceScopes, ...extra.resourceScopes]);
    }
    this.persist();
    return { ok: true, lease: { ...lease } };
  }

  public revoke(id: string, actor: PrivilegeActor): PrivilegeDecision {
    if (!OWNER_ACTORS.has(actor) && actor !== 'system') {
      return denied('REVOKE_FORBIDDEN', 'Only the owner can revoke a privilege lease.');
    }
    const lease = this.leases.get(id);
    if (!lease) return denied('UNKNOWN_LEASE', 'That privilege lease does not exist.');
    lease.revokedAt = new Date(this.now()).toISOString();
    this.persist();
    return { ok: true, lease: { ...lease } };
  }

  public peekValid(capabilityId: string, resourceScope?: string): PrivilegeDecision {
    return this.match(capabilityId, resourceScope, false);
  }

  public consume(capabilityId: string, resourceScope?: string): PrivilegeDecision {
    return this.match(capabilityId, resourceScope, true);
  }

  public get(id: string): PrivilegeLease | undefined {
    const lease = this.leases.get(id);
    return lease ? { ...lease } : undefined;
  }

  public list(): PrivilegeLease[] {
    return [...this.leases.values()].map(item => ({ ...item }));
  }

  private match(capabilityId: string, resourceScope: string | undefined, consume: boolean): PrivilegeDecision {
    if (isForbiddenGenericShell(capabilityId)) {
      return denied('GENERIC_SHELL_FORBIDDEN', 'Generic unrestricted shell is not a Jarvis capability.');
    }
    if (capabilityRequiresLease(capabilityId) === false && consume === false) {
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
        this.persist();
      }
      return { ok: true, lease: { ...lease } };
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

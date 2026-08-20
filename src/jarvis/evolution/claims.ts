import { randomBytes } from 'node:crypto';
import { looksLikeSecret } from '../security/redaction';
import type { JsonCollection } from './persistTypes';
import { TTL_MS, ttlClassForFactKey, type ClaimStatus, type TtlClass } from './taxonomy';

export type DurableClaim = {
  id: string;
  factKey: string;
  statement: string;
  source: string;
  learnedAt: string;
  lastVerifiedAt: string;
  confidence: number;
  status: ClaimStatus;
  ttlClass: TtlClass;
  supersededBy?: string;
  actor: 'owner' | 'webpage' | 'model' | 'system';
};

export class ClaimStore {
  private readonly claims = new Map<string, DurableClaim>();
  private readonly now: () => number;
  private readonly persist?: JsonCollection<DurableClaim>;

  constructor(now: () => number = () => Date.now(), persist?: JsonCollection<DurableClaim>) {
    this.now = now;
    this.persist = persist;
    for (const item of persist?.load() ?? []) this.claims.set(item.id, item);
  }

  public put(input: Omit<DurableClaim, 'id' | 'learnedAt' | 'lastVerifiedAt' | 'ttlClass' | 'supersededBy'> & {
    id?: string;
    ttlClass?: TtlClass;
  }): DurableClaim {
    if (looksLikeSecret(input.statement)) {
      throw Object.assign(new Error('Claim contained a secret and was rejected.'), { reasonCode: 'SECRET_IN_EXPERIENCE' });
    }
    if (input.actor === 'webpage') {
      throw Object.assign(new Error('Webpage content cannot write durable claims.'), { reasonCode: 'UNTRUSTED_MEMORY_WRITE' });
    }
    const at = new Date(this.now()).toISOString();
    const claim: DurableClaim = {
      ...input,
      id: input.id ?? `clm_${randomBytes(6).toString('hex')}`,
      learnedAt: at,
      lastVerifiedAt: at,
      ttlClass: input.ttlClass ?? ttlClassForFactKey(input.factKey),
      status: input.actor === 'owner' ? 'OWNER_CONFIRMED' : input.status,
    };
    const previous = this.activeByKey(claim.factKey);
    if (previous && previous.statement !== claim.statement) {
      previous.status = 'SUPERSEDED';
      previous.supersededBy = claim.id;
      this.claims.set(previous.id, previous);
    }
    this.claims.set(claim.id, claim);
    this.persist?.replace(this.list());
    return { ...claim };
  }

  public get(id: string): DurableClaim | undefined {
    const item = this.claims.get(id);
    return item ? { ...item } : undefined;
  }

  public active(): DurableClaim[] {
    this.markStale();
    return [...this.claims.values()].filter(item => item.status !== 'SUPERSEDED' && item.status !== 'STALE').map(item => ({ ...item }));
  }

  public activeByKey(factKey: string): DurableClaim | undefined {
    this.markStale();
    return [...this.claims.values()].find(item => item.factKey === factKey && item.status !== 'SUPERSEDED' && item.status !== 'STALE');
  }

  public list(): DurableClaim[] {
    this.markStale();
    return [...this.claims.values()].map(item => ({ ...item }));
  }

  private markStale(): void {
    const now = this.now();
    for (const claim of this.claims.values()) {
      if (claim.status === 'SUPERSEDED' || claim.status === 'STALE') continue;
      const age = now - Date.parse(claim.lastVerifiedAt);
      if (Number.isFinite(age) && age > TTL_MS[claim.ttlClass]) {
        claim.status = 'STALE';
      }
    }
  }
}

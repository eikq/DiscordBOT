import { CONFIRMATION_TTL_MS } from './constants';
import { hashesEqual, hashToken, issueConfirmationToken } from './hash';
import type { ActionProposal } from './types';

export type StoredConfirmation = {
  proposalId: string;
  tokenHash: string;
  argumentsHash: string;
  capabilityId: string;
  input: Record<string, unknown>;
  displayName: string;
  summary: string;
  target: string;
  expiresAt: number;
  used: boolean;
  denied: boolean;
  sessionId?: string;
  permissionProposal?: import('../../security/permissionProposal').PermissionProposal;
};

export type ConsumeResult =
  | { ok: true; record: StoredConfirmation }
  | { ok: false; reasonCode: string };

export class ConfirmationStore {
  private readonly records = new Map<string, StoredConfirmation>();
  /** In-memory plaintext only. Never persist confirmation tokens. */
  private readonly plaintextTokens = new Map<string, string>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      now?: () => number;
    } = {},
  ) {}

  public issue(proposal: ActionProposal, extra: {
    expiresAt?: number;
    permissionProposal?: StoredConfirmation['permissionProposal'];
    sessionId?: string;
  } = {}): { token: string; record: StoredConfirmation } {
    const now = this.now();
    const ttlMs = this.options.ttlMs ?? CONFIRMATION_TTL_MS;
    const issued = issueConfirmationToken();
    const record: StoredConfirmation = {
      proposalId: proposal.proposalId,
      tokenHash: issued.tokenHash,
      argumentsHash: proposal.argumentsHash,
      capabilityId: proposal.capabilityId,
      input: { ...proposal.normalizedArguments },
      displayName: proposal.displayName,
      summary: proposal.summary,
      target: proposal.target,
      expiresAt: extra.expiresAt ?? (now + ttlMs),
      used: false,
      denied: false,
      ...(extra.permissionProposal ? { permissionProposal: extra.permissionProposal } : {}),
      ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
    };
    this.records.set(proposal.proposalId, record);
    this.plaintextTokens.set(proposal.proposalId, issued.token);
    return { token: issued.token, record };
  }

  public unusedPlaintextToken(proposalId: string): string | undefined {
    const record = this.records.get(proposalId);
    if (!record || record.used || record.denied || this.now() > record.expiresAt) {
      this.plaintextTokens.delete(proposalId);
      return undefined;
    }
    return this.plaintextTokens.get(proposalId);
  }

  public unused(): StoredConfirmation[] {
    const now = this.now();
    return [...this.records.values()].filter(record => !record.used && !record.denied && record.expiresAt >= now);
  }

  public peek(proposalId: string): StoredConfirmation | undefined {
    return this.records.get(proposalId);
  }

  public consume(proposalId: string, token: string, argumentsHash: string): ConsumeResult {
    const record = this.records.get(proposalId);
    if (!record) return { ok: false, reasonCode: 'UNKNOWN_PROPOSAL' };
    if (record.denied) return { ok: false, reasonCode: 'PROPOSAL_DENIED' };
    if (this.now() > record.expiresAt) return { ok: false, reasonCode: 'CONFIRMATION_EXPIRED' };
    if (record.used) return { ok: false, reasonCode: 'CONFIRMATION_REUSED' };
    if (!hashesEqual(record.argumentsHash, argumentsHash)) return { ok: false, reasonCode: 'ARGUMENTS_CHANGED' };
    if (!hashesEqual(record.tokenHash, hashToken(token))) return { ok: false, reasonCode: 'INVALID_TOKEN' };
    record.used = true;
    this.plaintextTokens.delete(proposalId);
    return { ok: true, record };
  }

  public deny(proposalId: string): StoredConfirmation | undefined {
    const record = this.records.get(proposalId);
    if (!record) return undefined;
    record.denied = true;
    record.used = true;
    this.plaintextTokens.delete(proposalId);
    return record;
  }

  public denyAll(): string[] {
    const denied: string[] = [];
    for (const record of this.records.values()) {
      if (record.used || record.denied || this.now() > record.expiresAt) continue;
      record.denied = true;
      record.used = true;
      this.plaintextTokens.delete(record.proposalId);
      denied.push(record.proposalId);
    }
    return denied;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

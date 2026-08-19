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
};

export type ConsumeResult =
  | { ok: true; record: StoredConfirmation }
  | { ok: false; reasonCode: string };

export class ConfirmationStore {
  private readonly records = new Map<string, StoredConfirmation>();

  constructor(
    private readonly options: {
      ttlMs?: number;
      now?: () => number;
    } = {},
  ) {}

  public issue(proposal: ActionProposal): { token: string; record: StoredConfirmation } {
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
      expiresAt: now + ttlMs,
      used: false,
      denied: false,
    };
    this.records.set(proposal.proposalId, record);
    return { token: issued.token, record };
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
    return { ok: true, record };
  }

  public deny(proposalId: string): StoredConfirmation | undefined {
    const record = this.records.get(proposalId);
    if (!record) return undefined;
    record.denied = true;
    record.used = true;
    return record;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

import type { CapabilityDescriptor, CapabilityResult } from '../capabilities/types';
import type { VerificationRecord } from './types';

export type DeterministicVerifier = (input: {
  descriptor: CapabilityDescriptor;
  result: CapabilityResult;
  now: number;
}) => Promise<VerificationRecord> | VerificationRecord;

/** Deterministic capability postconditions only; no LLM verifier can mint VERIFIED. */
export class VerificationRegistry {
  private readonly verifiers = new Map<string, DeterministicVerifier>();

  public register(id: string, verifier: DeterministicVerifier): void {
    if (!/^[a-z][a-z0-9._-]{2,80}$/u.test(id)) throw new Error('Invalid verifier id.');
    if (this.verifiers.has(id)) throw new Error(`Verifier ${id} is already registered.`);
    this.verifiers.set(id, verifier);
  }

  public has(id: string): boolean {
    return this.verifiers.has(id);
  }

  public async verify(
    verifierId: string,
    descriptor: CapabilityDescriptor,
    result: CapabilityResult,
    now: number = Date.now(),
  ): Promise<VerificationRecord | undefined> {
    const verifier = this.verifiers.get(verifierId);
    return verifier?.({ descriptor, result, now });
  }
}

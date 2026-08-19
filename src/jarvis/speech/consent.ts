import type { CloneConsentGate } from './types';

export class MemoryCloneConsent implements CloneConsentGate {
  constructor(private readonly granted = new Set<string>()) {}

  public grant(profileId: string): void {
    this.granted.add(profileId.trim().toLowerCase());
  }

  public revoke(profileId: string): void {
    this.granted.delete(profileId.trim().toLowerCase());
  }

  public isCloneConsented(profileId: string): boolean {
    return this.granted.has(profileId.trim().toLowerCase());
  }
}

export class EnvCloneConsent implements CloneConsentGate {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  public isCloneConsented(profileId: string): boolean {
    const raw = this.env.STANDALONE_CLONE_CONSENT || '';
    return raw.split(',').some(item => item.trim().toLowerCase() === profileId.trim().toLowerCase());
  }
}

import type { PerceptualEvent, PrivacyClassification } from './types';

export type PerceptualRetention = {
  policy: 'bounded' | 'session' | 'owner_review';
  retentionClass: 'ephemeral' | 'session' | 'short_lived';
  maxAgeMs: number;
  expiresAt: number;
  persistToCanonical: false;
};

export type PerceptualMemoryCandidate = {
  eventId: string;
  memoryClass: 'perceptual' | 'episodic';
  privacyClass: PrivacyClassification;
  observation: string;
  simulated: boolean;
  status: 'candidate';
  accepted: false;
  retention: PerceptualRetention;
  evidenceRefs: string[];
};

const MAX_AGE_MS: Record<PrivacyClassification, number> = {
  public: 14 * 24 * 60 * 60_000,
  private: 7 * 24 * 60 * 60_000,
  sensitive: 24 * 60 * 60_000,
  secret: 30 * 60_000,
};

export function retentionForPrivacy(privacy: PrivacyClassification, now = 0): PerceptualRetention {
  const maxAgeMs = MAX_AGE_MS[privacy];
  const session = privacy === 'secret';
  return {
    policy: session ? 'session' : privacy === 'sensitive' ? 'bounded' : 'owner_review',
    retentionClass: session ? 'session' : privacy === 'sensitive' ? 'ephemeral' : 'short_lived',
    maxAgeMs,
    expiresAt: now + maxAgeMs,
    persistToCanonical: false,
  };
}

export function toPerceptualMemoryCandidate(
  event: PerceptualEvent,
  now = Date.parse(event.timestamp) || 0,
): PerceptualMemoryCandidate {
  return {
    eventId: event.id,
    memoryClass: event.source === 'cctv' || event.source === 'camera' ? 'perceptual' : 'episodic',
    privacyClass: event.privacyClassification,
    observation: event.observation,
    simulated: event.simulated,
    status: 'candidate',
    accepted: false,
    retention: retentionForPrivacy(event.privacyClassification, now),
    evidenceRefs: [...event.evidenceRefs],
  };
}

export function candidateIsExpired(candidate: PerceptualMemoryCandidate, now: number): boolean {
  return now >= candidate.retention.expiresAt;
}

export function dropExpiredCandidates(
  candidates: PerceptualMemoryCandidate[],
  now: number,
): PerceptualMemoryCandidate[] {
  return candidates.filter(item => !candidateIsExpired(item, now));
}

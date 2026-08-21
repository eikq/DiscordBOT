import type { JsonCollection } from './persistTypes';
import type { VerificationState } from '../safety/types';

export type CompetenceTrend = 'improving' | 'stable' | 'declining' | 'insufficient_data';

export type CapabilityAssessment = {
  capability: string;
  confidence: number | null;
  attempts: number;
  verifiedAttempts: number;
  successes: number;
  verifiedSuccesses: number;
  unverifiedSuccesses: number;
  partials: number;
  failures: number;
  recentTrend: CompetenceTrend;
  recurringWeaknesses: string[];
  evidenceRefs: string[];
  observedEvidenceIds: string[];
  lastVerificationState?: VerificationState;
  lastEvaluated: string;
};

export type CapabilityObservationEvidence = {
  verificationState?: VerificationState;
  evidenceRefs?: string[];
  observationId?: string;
};

export class CapabilitySelfModel {
  private readonly byId = new Map<string, CapabilityAssessment>();
  private readonly now: () => number;
  private readonly persist?: JsonCollection<CapabilityAssessment>;

  constructor(now: () => number = () => Date.now(), persist?: JsonCollection<CapabilityAssessment>) {
    this.now = now;
    this.persist = persist;
    for (const item of persist?.load() ?? []) this.byId.set(item.capability, normalizeAssessment(item));
  }

  public observe(
    capability: string,
    outcome: 'success' | 'partial' | 'failure',
    weakness?: string,
    evidence: CapabilityObservationEvidence = {},
  ): CapabilityAssessment {
    const current = this.byId.get(capability) ?? {
      capability,
      confidence: null,
      attempts: 0,
      verifiedAttempts: 0,
      successes: 0,
      verifiedSuccesses: 0,
      unverifiedSuccesses: 0,
      partials: 0,
      failures: 0,
      recentTrend: 'insufficient_data' as const,
      recurringWeaknesses: [],
      evidenceRefs: [],
      observedEvidenceIds: [],
      lastEvaluated: new Date(this.now()).toISOString(),
    };
    if (evidence.observationId && current.observedEvidenceIds.includes(evidence.observationId)) {
      return cloneAssessment(current);
    }
    current.attempts += 1;
    const verifiedSuccess = outcome === 'success' && evidence.verificationState === 'VERIFIED';
    const supportedPartial = outcome === 'partial' && evidence.verificationState === 'PARTIALLY_VERIFIED';
    const supportedFailure = outcome === 'failure' && (
      evidence.verificationState === 'FAILED_VERIFICATION'
      || Boolean(evidence.evidenceRefs?.length)
    );
    if (verifiedSuccess) {
      current.successes += 1;
      current.verifiedSuccesses += 1;
      current.verifiedAttempts += 1;
    } else if (outcome === 'success') {
      current.unverifiedSuccesses += 1;
    }
    if (outcome === 'partial') {
      current.partials += 1;
      if (supportedPartial) current.verifiedAttempts += 1;
    }
    if (outcome === 'failure') current.failures += 1;
    if (supportedFailure) current.verifiedAttempts += 1;
    if (weakness && !current.recurringWeaknesses.includes(weakness)) {
      current.recurringWeaknesses = [...current.recurringWeaknesses, weakness].slice(-6);
    }
    current.evidenceRefs = unique([...(current.evidenceRefs ?? []), ...(evidence.evidenceRefs ?? [])]).slice(-12);
    if (evidence.observationId) {
      current.observedEvidenceIds = [...current.observedEvidenceIds, evidence.observationId].slice(-64);
    }
    current.lastVerificationState = evidence.verificationState;
    current.lastEvaluated = new Date(this.now()).toISOString();
    if (current.verifiedAttempts < 3) {
      current.confidence = null;
      current.recentTrend = 'insufficient_data';
    } else {
      current.confidence = current.verifiedSuccesses / current.verifiedAttempts;
      const recentRatio = current.confidence;
      current.recentTrend = recentRatio >= 0.75 ? 'improving' : recentRatio <= 0.4 ? 'declining' : 'stable';
    }
    this.byId.set(capability, current);
    this.persist?.replace(this.matrix());
    return cloneAssessment(current);
  }

  public get(capability: string): CapabilityAssessment | undefined {
    const item = this.byId.get(capability);
    return item ? cloneAssessment(item) : undefined;
  }

  public matrix(): CapabilityAssessment[] {
    return [...this.byId.values()].map(cloneAssessment);
  }
}

function normalizeAssessment(item: CapabilityAssessment): CapabilityAssessment {
  const legacySuccesses = Number(item.successes || 0);
  const verifiedSuccesses = Number(item.verifiedSuccesses || 0);
  const failures = Number(item.failures || 0);
  const verifiedAttempts = Number(item.verifiedAttempts ?? failures);
  const confidence = verifiedAttempts < 3 ? null : verifiedSuccesses / verifiedAttempts;
  return {
    ...item,
    confidence,
    recentTrend: confidence === null
      ? 'insufficient_data'
      : confidence >= 0.75
        ? 'improving'
        : confidence <= 0.4
          ? 'declining'
          : 'stable',
    successes: verifiedSuccesses,
    verifiedSuccesses,
    unverifiedSuccesses: Number(item.unverifiedSuccesses ?? legacySuccesses),
    verifiedAttempts,
    evidenceRefs: [...(item.evidenceRefs ?? [])],
    observedEvidenceIds: [...(item.observedEvidenceIds ?? [])],
    recurringWeaknesses: [...(item.recurringWeaknesses ?? [])],
  };
}

function cloneAssessment(item: CapabilityAssessment): CapabilityAssessment {
  return {
    ...item,
    recurringWeaknesses: [...item.recurringWeaknesses],
    evidenceRefs: [...item.evidenceRefs],
    observedEvidenceIds: [...item.observedEvidenceIds],
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

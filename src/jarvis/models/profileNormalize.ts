import type { EvidenceState, HardwareRequirements, LatencyEvidence, ModelProfile, ThroughputEvidence } from './types';
import { UNKNOWN_ABILITY } from './types';

export type ModelProfileSeed = Partial<ModelProfile> & {
  id: string;
};

export function isKnownAbility(state: EvidenceState): boolean {
  return state === 'fixture_only' || state === 'cloud_verified' || state === 'locally_verified';
}

export function abilityOrUnknown(state?: EvidenceState): EvidenceState {
  return state ?? UNKNOWN_ABILITY;
}

export function normalizeProfile(seed: ModelProfileSeed): ModelProfile {
  const engine = seed.engine
    ?? seed.engineCompatibility?.[0]
    ?? 'unknown';
  const notes = seed.hardwareRequirements?.notes
    ?? seed.resourceRequirements
    ?? 'not measured in cloud';
  const latency: LatencyEvidence = {
    source: seed.latencyEvidence?.source ?? UNKNOWN_ABILITY,
    ...(typeof seed.latencyEvidence?.p50Ms === 'number' ? { p50Ms: seed.latencyEvidence.p50Ms } : {}),
    ...(typeof seed.latencyEvidence?.p95Ms === 'number' ? { p95Ms: seed.latencyEvidence.p95Ms } : {}),
  };
  const throughput: ThroughputEvidence = {
    source: seed.throughputEvidence?.source ?? UNKNOWN_ABILITY,
    ...(typeof seed.throughputEvidence?.tokensPerSec === 'number'
      ? { tokensPerSec: seed.throughputEvidence.tokensPerSec }
      : {}),
  };
  const hardware: HardwareRequirements = {
    notes,
    measured: seed.hardwareRequirements?.measured === true,
    ...(typeof seed.hardwareRequirements?.ramBytes === 'number' ? { ramBytes: seed.hardwareRequirements.ramBytes } : {}),
    ...(typeof seed.hardwareRequirements?.vramBytes === 'number' ? { vramBytes: seed.hardwareRequirements.vramBytes } : {}),
  };
  return {
    id: seed.id,
    modelId: seed.modelId ?? seed.id,
    provider: seed.provider ?? (seed.id.includes('fixture') ? 'fixture' : 'unknown'),
    engine,
    family: seed.family ?? 'unknown',
    engineCompatibility: seed.engineCompatibility ?? [engine],
    local: seed.local ?? false,
    cloud: seed.cloud ?? false,
    quantization: seed.quantization,
    contextTokens: seed.contextTokens,
    vision: abilityOrUnknown(seed.vision),
    toolCalling: abilityOrUnknown(seed.toolCalling),
    reasoning: abilityOrUnknown(seed.reasoning),
    structuredOutput: abilityOrUnknown(seed.structuredOutput),
    thai: abilityOrUnknown(seed.thai),
    coding: abilityOrUnknown(seed.coding),
    agent: abilityOrUnknown(seed.agent),
    research: abilityOrUnknown(seed.research),
    recovery: abilityOrUnknown(seed.recovery),
    contextCapability: abilityOrUnknown(seed.contextCapability),
    latencyEvidence: latency,
    throughputEvidence: throughput,
    hardwareRequirements: hardware,
    resourceRequirements: seed.resourceRequirements ?? notes,
    trustTier: seed.trustTier === 'RESTRICTED' || seed.trustTier === 'EXPERIMENTAL' || seed.trustTier === 'STANDARD'
      ? seed.trustTier
      : 'STANDARD',
    alignmentStatus: seed.alignmentStatus ?? 'unknown',
    lastLocallyVerified: seed.lastLocallyVerified ?? null,
    certificationState: seed.certificationState ?? 'UNVERIFIED',
    available: seed.available !== false,
    securityAuthority: false,
  };
}

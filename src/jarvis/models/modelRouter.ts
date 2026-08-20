import type { CapabilityCertificationBank } from './capabilityCertification';
import type { ModelProfileRegistry } from './modelProfileRegistry';
import { isKnownAbility } from './profileNormalize';
import type {
  HardwareRoutingHint,
  ModelProfile,
  ModelRouteIntent,
  ModelTrustTier,
  ModelWorkload,
} from './types';
import { normalizeWorkload } from './workload';

export type ModelRouteDecision = {
  intent: ModelRouteIntent;
  workload: ModelWorkload;
  modelProfileId: string;
  trustTier: ModelTrustTier;
  reason: string;
  restrictedSelected: false;
  usedSpeculativeScore: false;
  hardwareUsed: boolean;
  idleAssumed: false;
  available: boolean;
  fallbackFrom?: string;
  fallbackReason?: string;
};

type AbilityKey = 'coding' | 'thai' | 'reasoning' | 'toolCalling' | 'research' | 'vision' | 'recovery' | 'contextCapability';

const WORKLOAD_PREFERENCE: Record<ModelWorkload, { prefer: string[]; require?: AbilityKey[]; realtime?: boolean }> = {
  casual: { prefer: ['cloud-fixture-chat', 'local-env-llm', 'qwen38-27b-aligned'] },
  information: { prefer: ['cloud-fixture-chat', 'local-env-llm', 'qwen38-27b-aligned'] },
  deep_reasoning: { prefer: ['qwen38-27b-aligned', 'local-env-llm', 'cloud-fixture-chat'], require: ['reasoning'] },
  research: { prefer: ['cloud-fixture-chat', 'local-env-llm', 'qwen38-27b-aligned'], require: ['research'] },
  coding: { prefer: ['qwen38-27b-aligned', 'local-env-llm', 'cloud-fixture-chat'], require: ['coding'] },
  voice_realtime: { prefer: ['local-env-llm', 'cloud-fixture-chat'], realtime: true },
  night_background: { prefer: ['qwen38-27b-aligned', 'local-env-llm', 'cloud-fixture-chat'] },
  vision: { prefer: ['cloud-fixture-chat', 'local-env-llm'], require: ['vision'] },
};

const TRUSTED_FALLBACKS = ['cloud-fixture-chat', 'local-env-llm'] as const;
const STANDARD_NIGHT_FALLBACKS = ['local-env-llm', 'cloud-fixture-chat'] as const;
const RESTRICTED_ID = 'qwen38-27b-uncensored';
const NIGHT_STRONGER_ID = 'qwen38-27b-aligned';

/**
 * Deterministic policy router. Certified/fixture evidence only.
 * Does not use speculative AI-generated scores.
 * RESTRICTED profiles are never auto-selected and never become security authorities.
 * Idle-only stronger night routing requires explicit runtime idle=true (not assumed).
 */
export function routeModelProfile(input: {
  intent: ModelRouteIntent;
  workload?: ModelWorkload;
  profiles: ModelProfileRegistry;
  certifications?: CapabilityCertificationBank;
  hardware?: HardwareRoutingHint;
}): ModelRouteDecision {
  const workload = input.workload ?? normalizeWorkload(input.intent);
  const preferred = WORKLOAD_PREFERENCE[workload];
  const eligible = eligibleProfiles(input.profiles, input.hardware);
  let hardwareUsed = false;

  if (workload === 'night_background') {
    const idleMeasured = input.hardware?.idle === true && input.hardware.idleSource !== 'assumed';
    if (!idleMeasured) {
      const fallback = pickByIds(eligible, STANDARD_NIGHT_FALLBACKS)
        ?? eligible.find(item => item.trustTier === 'STANDARD');
      return decision({
        intent: input.intent,
        workload,
        profile: fallback,
        reason: 'night_background requires measured idle=true before a stronger model',
        hardwareUsed: false,
        fallbackFrom: NIGHT_STRONGER_ID,
        fallbackReason: 'not_idle',
      });
    }
    hardwareUsed = true;
  }

  const ranked = rankCandidates(eligible, preferred.prefer, input.hardware);
  const required = preferred.require;
  const firstWanted = ranked.find(profile => (
    (!required || evidenceAllows(profile, required, input.certifications))
    && meetsLatency(profile, preferred.realtime === true, input.hardware)
    && meetsContext(profile, input.hardware)
  ));
  const ownerPreferredId = input.hardware?.preferredModelId;
  const ownerPreferred = ownerPreferredId && ownerPreferredId !== RESTRICTED_ID
    ? ranked.find(item => item.id === ownerPreferredId)
    : undefined;
  if (
    ownerPreferred
    && ownerPreferred.trustTier !== 'RESTRICTED'
    && (!required || evidenceAllows(ownerPreferred, required, input.certifications))
    && meetsLatency(ownerPreferred, preferred.realtime === true, input.hardware)
    && meetsContext(ownerPreferred, input.hardware)
  ) {
    const skipped = ranked[0] && ranked[0].id !== ownerPreferred.id ? ranked[0].id : undefined;
    return decision({
      intent: input.intent,
      workload,
      profile: ownerPreferred,
      reason: evidenceReason(ownerPreferred, input.certifications),
      hardwareUsed,
      fallbackFrom: skipped,
      fallbackReason: skipped ? 'owner_preference' : undefined,
    });
  }

  if (firstWanted) {
    const primary = preferred.prefer[0];
    const skipped = skipReason(input.profiles, primary, input.hardware, firstWanted.id);
    const ownerSkip = ownerPreferredId
      && ownerPreferredId !== firstWanted.id
      && ownerPreferredId !== RESTRICTED_ID
      ? { from: ownerPreferredId, reason: 'owner_preference_incompatible' }
      : undefined;
    return decision({
      intent: input.intent,
      workload,
      profile: firstWanted,
      reason: evidenceReason(firstWanted, input.certifications),
      hardwareUsed,
      fallbackFrom: skipped?.from ?? ownerSkip?.from,
      fallbackReason: skipped?.reason ?? ownerSkip?.reason,
    });
  }

  const fallback = pickByIds(eligible, TRUSTED_FALLBACKS)
    ?? eligible.find(item => item.trustTier === 'STANDARD')
    ?? eligible[0];
  const missed = preferred.prefer.find(id => input.profiles.get(id)?.trustTier !== 'RESTRICTED');
  return decision({
    intent: input.intent,
    workload,
    profile: fallback,
    reason: 'uncertified_fallback',
    hardwareUsed,
    fallbackFrom: missed && missed !== fallback?.id ? missed : undefined,
    fallbackReason: missed && missed !== fallback?.id ? 'incompatible_or_unverified' : undefined,
  });
}

function eligibleProfiles(profiles: ModelProfileRegistry, hardware?: HardwareRoutingHint): ModelProfile[] {
  const allow = hardware?.availableModelIds ? new Set(hardware.availableModelIds) : undefined;
  return profiles.list().filter(item => {
    if (item.trustTier === 'RESTRICTED') return false;
    if (item.available === false) return false;
    if (allow && item.id !== 'cloud-fixture-chat' && !allow.has(item.id)) return false;
    return true;
  });
}

function rankCandidates(eligible: ModelProfile[], prefer: string[], hardware?: HardwareRoutingHint): ModelProfile[] {
  const byId = new Map(eligible.map(item => [item.id, item]));
  const ordered: ModelProfile[] = [];
  const seen = new Set<string>();
  const ownerId = hardware?.preferredModelId;
  if (ownerId && ownerId !== RESTRICTED_ID && byId.get(ownerId)?.trustTier !== 'RESTRICTED') {
    ordered.push(byId.get(ownerId)!);
    seen.add(ownerId);
  }
  for (const id of prefer) {
    const item = byId.get(id);
    if (!item || seen.has(id)) continue;
    ordered.push(item);
    seen.add(id);
  }
  for (const item of eligible) {
    if (seen.has(item.id)) continue;
    ordered.push(item);
  }
  return ordered;
}

function skipReason(
  profiles: ModelProfileRegistry,
  primaryId: string | undefined,
  hardware: HardwareRoutingHint | undefined,
  chosenId: string,
): { from: string; reason: string } | undefined {
  if (!primaryId || primaryId === chosenId) return undefined;
  const item = profiles.get(primaryId);
  if (!item || item.trustTier === 'RESTRICTED') return undefined;
  if (item.available === false) return { from: primaryId, reason: 'unavailable' };
  if (hardware?.availableModelIds && primaryId !== 'cloud-fixture-chat' && !hardware.availableModelIds.includes(primaryId)) {
    return { from: primaryId, reason: 'unavailable' };
  }
  return { from: primaryId, reason: 'incompatible_or_unverified' };
}

function pickByIds(eligible: ModelProfile[], ids: readonly string[]): ModelProfile | undefined {
  for (const id of ids) {
    const found = eligible.find(item => item.id === id);
    if (found) return found;
  }
  return undefined;
}

function evidenceAllows(
  profile: ModelProfile,
  keys: AbilityKey[],
  certifications?: CapabilityCertificationBank,
): boolean {
  const cert = certifications?.latest(profile.id);
  if (cert?.status === 'CERTIFIED' || cert?.status === 'CLOUD_VERIFIED') return true;
  if (profile.id === 'cloud-fixture-chat') return true;
  return keys.every(key => isKnownAbility(profile[key]));
}

function meetsLatency(profile: ModelProfile, realtime: boolean, hardware?: HardwareRoutingHint): boolean {
  const budget = hardware?.latencyBudgetMs;
  if (!realtime && budget === undefined) return true;
  const p50 = profile.latencyEvidence.p50Ms;
  if (typeof budget === 'number' && typeof p50 === 'number' && p50 > budget) return false;
  if (realtime && profile.trustTier === 'EXPERIMENTAL' && profile.latencyEvidence.source === 'unverified') {
    return false;
  }
  return true;
}

function meetsContext(profile: ModelProfile, hardware?: HardwareRoutingHint): boolean {
  const min = hardware?.minContextTokens;
  if (typeof min !== 'number') return true;
  if (typeof profile.contextTokens !== 'number') return profile.id === 'cloud-fixture-chat';
  return profile.contextTokens >= min;
}

function evidenceReason(profile: ModelProfile, certifications?: CapabilityCertificationBank): string {
  const cert = certifications?.latest(profile.id);
  if (cert?.status === 'CERTIFIED') return `certified:${profile.id}`;
  if (cert?.status === 'CLOUD_VERIFIED') return `cloud_verified:${profile.id}`;
  if (cert?.status === 'FIXTURE_ONLY') return `fixture_only:${profile.id}`;
  if (profile.lastLocallyVerified) return `locally_verified:${profile.id}`;
  if (profile.id === 'cloud-fixture-chat') return `fixture_only:${profile.id}`;
  return `uncertified_fallback:${profile.id}`;
}

function decision(input: {
  intent: ModelRouteIntent;
  workload: ModelWorkload;
  profile: ModelProfile | undefined;
  reason: string;
  hardwareUsed: boolean;
  fallbackFrom?: string;
  fallbackReason?: string;
}): ModelRouteDecision {
  let chosen: { id: string; trustTier: ModelTrustTier; available?: boolean } | undefined = input.profile;
  let fallbackFrom = input.fallbackFrom;
  let fallbackReason = input.fallbackReason;
  let reason = input.reason;
  if (!chosen || chosen.trustTier === 'RESTRICTED') {
    fallbackFrom = chosen?.id ?? fallbackFrom;
    fallbackReason = chosen?.trustTier === 'RESTRICTED' ? 'restricted' : fallbackReason;
    reason = chosen?.trustTier === 'RESTRICTED' ? 'restricted_blocked' : reason;
    chosen = {
      id: 'local-env-llm',
      trustTier: 'STANDARD',
      available: true,
    };
  }
  return {
    intent: input.intent,
    workload: input.workload,
    modelProfileId: chosen.id,
    trustTier: chosen.trustTier,
    reason,
    restrictedSelected: false,
    usedSpeculativeScore: false,
    hardwareUsed: input.hardwareUsed,
    idleAssumed: false,
    available: chosen.available !== false,
    ...(fallbackFrom ? { fallbackFrom } : {}),
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}

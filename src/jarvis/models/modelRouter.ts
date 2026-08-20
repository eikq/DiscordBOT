import type { ModelProfileRegistry } from './modelProfileRegistry';
import type { CapabilityCertificationBank } from './capabilityCertification';
import type { HardwareRoutingHint, ModelProfile, ModelRouteIntent } from './types';

export type ModelRouteDecision = {
  intent: ModelRouteIntent;
  modelProfileId: string;
  trustTier: ModelProfile['trustTier'];
  reason: string;
  restrictedSelected: boolean;
  usedSpeculativeScore: false;
  hardwareUsed: boolean;
};

const INTENT_PREFERENCE: Record<ModelRouteIntent, { prefer: string[]; require?: Array<keyof Pick<ModelProfile, 'coding' | 'thai' | 'reasoning' | 'toolCalling'>> }> = {
  casual_chat: { prefer: ['cloud-fixture-chat', 'local-env-llm', 'qwen38-27b-aligned'] },
  deep_reasoning: { prefer: ['qwen38-27b-aligned', 'local-env-llm'] },
  coding: { prefer: ['qwen38-27b-aligned', 'local-env-llm'], require: ['coding'] },
  voice: { prefer: ['local-env-llm', 'cloud-fixture-chat'] },
  night_background: { prefer: ['qwen38-27b-aligned', 'local-env-llm'] },
};

/**
 * Deterministic policy router. Certified evidence only.
 * Does not use speculative AI-generated scores.
 * RESTRICTED uncensored profiles are never auto-selected.
 * Idle-only stronger routing requires an explicit hardware.idle=true measurement.
 */
export function routeModelProfile(input: {
  intent: ModelRouteIntent;
  profiles: ModelProfileRegistry;
  certifications?: CapabilityCertificationBank;
  hardware?: HardwareRoutingHint;
}): ModelRouteDecision {
  const catalog = input.profiles.list().filter(item => item.trustTier !== 'RESTRICTED');
  const preferred = INTENT_PREFERENCE[input.intent];
  let hardwareUsed = false;
  if (input.intent === 'night_background') {
    if (input.hardware?.idle !== true) {
      const fallback = catalog.find(item => item.id === 'local-env-llm') ?? catalog[0];
      return decision(input.intent, fallback, 'night_background requires measured idle=true before a stronger model', false);
    }
    hardwareUsed = true;
  }
  for (const id of preferred.prefer) {
    const profile = catalog.find(item => item.id === id);
    if (!profile) continue;
    if (preferred.require && !evidenceAllows(profile, preferred.require, input.certifications)) {
      continue;
    }
    return decision(input.intent, profile, evidenceReason(profile, input.certifications), hardwareUsed);
  }
  const fallback = catalog.find(item => item.trustTier === 'STANDARD') ?? catalog[0];
  return decision(input.intent, fallback, 'uncertified_fallback', hardwareUsed);
}

function evidenceAllows(
  profile: ModelProfile,
  keys: Array<keyof Pick<ModelProfile, 'coding' | 'thai' | 'reasoning' | 'toolCalling'>>,
  certifications?: CapabilityCertificationBank,
): boolean {
  const cert = certifications?.latest(profile.id);
  if (cert?.status === 'CERTIFIED') return true;
  if (profile.id === 'cloud-fixture-chat') return true;
  return keys.every(key => profile[key] === 'locally_verified' || profile[key] === 'fixture_only');
}

function evidenceReason(profile: ModelProfile, certifications?: CapabilityCertificationBank): string {
  const cert = certifications?.latest(profile.id);
  if (cert?.status === 'CERTIFIED') return `certified:${profile.id}`;
  if (cert?.status === 'FIXTURE_ONLY') return `fixture_only:${profile.id}`;
  if (profile.lastLocallyVerified) return `locally_verified:${profile.id}`;
  return `uncertified_fallback:${profile.id}`;
}

function decision(
  intent: ModelRouteIntent,
  profile: ModelProfile | undefined,
  reason: string,
  hardwareUsed: boolean,
): ModelRouteDecision {
  const chosen = profile ?? {
    id: 'local-env-llm',
    trustTier: 'STANDARD' as const,
  };
  return {
    intent,
    modelProfileId: chosen.id,
    trustTier: chosen.trustTier,
    reason,
    restrictedSelected: chosen.trustTier === 'RESTRICTED',
    usedSpeculativeScore: false,
    hardwareUsed,
  };
}

import type { JsonCollection } from '../evolution/persistTypes';
import type { ModelProfile } from './types';

export function catalogModelProfiles(): ModelProfile[] {
  return [
    {
      id: 'local-env-llm',
      family: 'unknown',
      engineCompatibility: ['ollama-compatible'],
      local: true,
      cloud: false,
      vision: 'unverified',
      toolCalling: 'unverified',
      reasoning: 'unverified',
      structuredOutput: 'unverified',
      thai: 'unverified',
      coding: 'unverified',
      agent: 'unverified',
      resourceRequirements: 'host-dependent; not measured in cloud',
      trustTier: 'STANDARD',
      alignmentStatus: 'unknown',
      lastLocallyVerified: null,
      securityAuthority: false,
    },
    {
      id: 'qwen38-27b-aligned',
      family: 'qwen3.8',
      engineCompatibility: ['ollama-compatible'],
      local: true,
      cloud: false,
      quantization: 'unknown-until-local-discovery',
      contextTokens: undefined,
      vision: 'unverified',
      toolCalling: 'unverified',
      reasoning: 'unverified',
      structuredOutput: 'unverified',
      thai: 'unverified',
      coding: 'unverified',
      agent: 'unverified',
      resourceRequirements: 'large local GPU; BLOCKED_LOCAL_ACCEPTANCE',
      trustTier: 'EXPERIMENTAL',
      alignmentStatus: 'aligned_unverified',
      lastLocallyVerified: null,
      securityAuthority: false,
    },
    {
      id: 'qwen38-27b-uncensored',
      family: 'qwen3.8',
      engineCompatibility: ['ollama-compatible'],
      local: true,
      cloud: false,
      vision: 'unverified',
      toolCalling: 'unverified',
      reasoning: 'unverified',
      structuredOutput: 'unverified',
      thai: 'unverified',
      coding: 'unverified',
      agent: 'unverified',
      resourceRequirements: 'large local GPU; BLOCKED_LOCAL_ACCEPTANCE',
      trustTier: 'RESTRICTED',
      alignmentStatus: 'abliterated_unverified',
      lastLocallyVerified: null,
      securityAuthority: false,
    },
    {
      id: 'cloud-fixture-chat',
      family: 'fixture',
      engineCompatibility: ['in-process-fixture'],
      local: false,
      cloud: false,
      vision: 'fixture_only',
      toolCalling: 'fixture_only',
      reasoning: 'fixture_only',
      structuredOutput: 'fixture_only',
      thai: 'fixture_only',
      coding: 'fixture_only',
      agent: 'fixture_only',
      resourceRequirements: 'none',
      trustTier: 'STANDARD',
      alignmentStatus: 'unknown',
      lastLocallyVerified: null,
      securityAuthority: false,
    },
  ];
}

export function modelMayNotAuthorize(_profile: ModelProfile): true {
  return true;
}

export function restrictedHasNoSecurityAuthority(profile: ModelProfile): boolean {
  return profile.securityAuthority === false && (profile.trustTier !== 'RESTRICTED' || profile.securityAuthority === false);
}

export class ModelProfileRegistry {
  private readonly items = new Map<string, ModelProfile>();

  constructor(persist?: JsonCollection<ModelProfile>) {
    const loaded = persist?.load() ?? [];
    const seed = loaded.length > 0 ? loaded : catalogModelProfiles();
    for (const item of seed) this.items.set(item.id, freezeProfile(item));
  }

  public get(id: string): ModelProfile | undefined {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  public list(): ModelProfile[] {
    return [...this.items.values()].map(item => ({ ...item }));
  }

  public restricted(): ModelProfile[] {
    return this.list().filter(item => item.trustTier === 'RESTRICTED');
  }
}

function freezeProfile(profile: ModelProfile): ModelProfile {
  return { ...profile, securityAuthority: false };
}

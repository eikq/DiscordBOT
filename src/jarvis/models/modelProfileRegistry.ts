import type { JsonCollection } from '../evolution/persistTypes';
import { normalizeProfile, type ModelProfileSeed } from './profileNormalize';
import type { ModelProfile } from './types';

function abilities(state: ModelProfile['vision']): Pick<ModelProfile,
  'vision' | 'toolCalling' | 'reasoning' | 'structuredOutput' | 'thai' | 'coding' | 'agent' | 'research' | 'recovery' | 'contextCapability'
> {
  return {
    vision: state,
    toolCalling: state,
    reasoning: state,
    structuredOutput: state,
    thai: state,
    coding: state,
    agent: state,
    research: state,
    recovery: state,
    contextCapability: state,
  };
}

export function catalogModelProfiles(): ModelProfile[] {
  const seeds: ModelProfileSeed[] = [
    {
      id: 'local-env-llm',
      family: 'unknown',
      provider: 'unknown',
      engine: 'ollama-compatible',
      engineCompatibility: ['ollama-compatible'],
      local: true,
      cloud: false,
      ...abilities('unverified'),
      resourceRequirements: 'host-dependent; not measured in cloud',
      trustTier: 'STANDARD',
      alignmentStatus: 'unknown',
      lastLocallyVerified: null,
      certificationState: 'UNVERIFIED',
    },
    {
      id: 'qwen38-27b-aligned',
      family: 'qwen3.8',
      provider: 'ollama',
      engine: 'ollama-compatible',
      engineCompatibility: ['ollama-compatible'],
      local: true,
      cloud: false,
      quantization: 'unknown-until-local-discovery',
      contextTokens: undefined,
      ...abilities('unverified'),
      resourceRequirements: 'large local GPU; BLOCKED_LOCAL_ACCEPTANCE',
      trustTier: 'EXPERIMENTAL',
      alignmentStatus: 'aligned_unverified',
      lastLocallyVerified: null,
      certificationState: 'BLOCKED_LOCAL_ACCEPTANCE',
    },
    {
      id: 'qwen38-27b-uncensored',
      family: 'qwen3.8',
      provider: 'ollama',
      engine: 'ollama-compatible',
      engineCompatibility: ['ollama-compatible'],
      local: true,
      cloud: false,
      ...abilities('unverified'),
      resourceRequirements: 'large local GPU; BLOCKED_LOCAL_ACCEPTANCE',
      trustTier: 'RESTRICTED',
      alignmentStatus: 'abliterated_unverified',
      lastLocallyVerified: null,
      certificationState: 'BLOCKED_LOCAL_ACCEPTANCE',
    },
    {
      id: 'cloud-fixture-chat',
      family: 'fixture',
      provider: 'fixture',
      engine: 'in-process-fixture',
      engineCompatibility: ['in-process-fixture'],
      local: false,
      cloud: false,
      ...abilities('fixture_only'),
      latencyEvidence: { source: 'fixture_only' },
      throughputEvidence: { source: 'unverified' },
      resourceRequirements: 'none',
      trustTier: 'STANDARD',
      alignmentStatus: 'unknown',
      lastLocallyVerified: null,
      certificationState: 'FIXTURE_ONLY',
    },
  ];
  return seeds.map(seed => normalizeProfile(seed));
}

export function modelMayNotAuthorize(_profile: ModelProfile): true {
  return true;
}

export function restrictedHasNoSecurityAuthority(profile: ModelProfile): boolean {
  return profile.securityAuthority === false;
}

export function neverAutoSelectRestricted(profile: ModelProfile): boolean {
  return profile.trustTier === 'RESTRICTED';
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

  public setAvailable(id: string, available: boolean): ModelProfile | undefined {
    const item = this.items.get(id);
    if (!item) return undefined;
    item.available = available;
    return { ...item };
  }
}

function freezeProfile(profile: ModelProfileSeed | ModelProfile): ModelProfile {
  return { ...normalizeProfile(profile), securityAuthority: false };
}

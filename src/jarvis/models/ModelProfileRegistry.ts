import type { ModelProfile } from './types';

export class ModelProfileRegistry {
  private readonly profiles = new Map<string, ModelProfile>();

  public register(profile: ModelProfile): void {
    validateProfile(profile);
    if (this.profiles.has(profile.id)) throw new Error(`Model profile ${profile.id} is already registered.`);
    this.profiles.set(profile.id, cloneProfile(profile));
  }

  public replace(profile: ModelProfile): void {
    validateProfile(profile);
    this.profiles.set(profile.id, cloneProfile(profile));
  }

  public get(id: string): ModelProfile | undefined {
    const profile = this.profiles.get(id);
    return profile ? cloneProfile(profile) : undefined;
  }

  public list(): ModelProfile[] {
    return [...this.profiles.values()].map(cloneProfile);
  }
}

function validateProfile(profile: ModelProfile): void {
  if (!profile.id.trim() || profile.id.length > 160) throw new Error('Model profile id is required and bounded.');
  if (!profile.displayName.trim() || profile.displayName.length > 160) throw new Error('Model display name is required and bounded.');
  if (profile.parameterCount !== undefined && (!Number.isFinite(profile.parameterCount) || profile.parameterCount <= 0)) {
    throw new Error('Known parameterCount must be a positive number.');
  }
  if (!Array.isArray(profile.modalities)) throw new Error('Model modalities must be an array; an empty array means unknown.');
}

function cloneProfile(profile: ModelProfile): ModelProfile {
  return {
    ...profile,
    modalities: [...profile.modalities],
    ...(profile.languages ? { languages: [...profile.languages] } : {}),
    ...(profile.specialization ? { specialization: [...profile.specialization] } : {}),
    ...(profile.contextLimits ? { contextLimits: { ...profile.contextLimits } } : {}),
    ...(profile.hardwareRequirements ? { hardwareRequirements: { ...profile.hardwareRequirements } } : {}),
  };
}

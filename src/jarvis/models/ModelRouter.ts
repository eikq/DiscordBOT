import type { InferenceProvider } from './InferenceProvider';
import type { ModelCertificationRegistry } from './ModelCertificationRegistry';
import type { ModelProfileRegistry } from './ModelProfileRegistry';
import type { ModelCapability } from './types';

export type ModelRouteRequest = {
  requiredCapabilities: ModelCapability[];
  preferredModelId?: string;
  allowPartial?: boolean;
};

export type ModelRoute = {
  provider: InferenceProvider;
  modelId: string;
  certifications: Array<{ capability: ModelCapability; state: string }>;
};

export class ModelRouter {
  public constructor(
    private readonly profiles: ModelProfileRegistry,
    private readonly certifications: ModelCertificationRegistry,
    private readonly providers: InferenceProvider[],
  ) {}

  public async route(request: ModelRouteRequest): Promise<ModelRoute | undefined> {
    for (const provider of this.providers) {
      const reportedProfile = await provider.modelInfo();
      const profile = reportedProfile ?? this.profiles.get(provider.id);
      if (request.preferredModelId && profile?.id !== request.preferredModelId) continue;
      if (!profile || !profileSupportsDeclaredRequirements(profile, request.requiredCapabilities)) continue;
      const states = request.requiredCapabilities.map(capability => ({
        capability,
        state: this.certifications.state(profile.id, capability),
      }));
      const eligible = states.every(item => item.state === 'PASS' || (request.allowPartial && item.state === 'PARTIAL'));
      if (!eligible) continue;
      const health = await provider.health();
      if (!health.available || health.modelAvailable === false) continue;
      return { provider, modelId: profile.id, certifications: states };
    }
    return undefined;
  }
}

function profileSupportsDeclaredRequirements(
  profile: NonNullable<Awaited<ReturnType<InferenceProvider['modelInfo']>>>,
  required: ModelCapability[],
): boolean {
  if (required.includes('TOOL_SELECTION') && profile.toolUse === false) return false;
  if (required.includes('STRUCTURED_OUTPUT') && profile.structuredOutput === false) return false;
  if (required.includes('VISION') && profile.vision !== true && !profile.modalities.includes('vision')) return false;
  return true;
}

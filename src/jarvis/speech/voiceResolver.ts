import type { VoiceProfileAvailability, VoiceProfileResolver } from '../presentation/types';
import type { VoiceOutputRouter } from './types';

export class RouterVoiceResolver implements VoiceProfileResolver {
  constructor(private readonly router: VoiceOutputRouter) {}

  public async resolve(profileId: string): Promise<VoiceProfileAvailability> {
    const probed = await this.router.probeProfile(profileId);
    return {
      profileId: probed.profileId,
      selected: true,
      available: probed.available,
      speechActive: probed.speechActive,
      consented: probed.consented,
      reason: probed.reason,
    };
  }
}

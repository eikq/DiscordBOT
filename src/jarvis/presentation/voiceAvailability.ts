import { getVoiceServiceBaseUrl } from '../../bot/voice/VoiceServiceConfig';
import {
  ELEMISU_VOICE_ID,
  GAM_VOICE_ID,
  JARVIS_VOICE_ID,
  type VoiceProfileAvailability,
  type VoiceProfileResolver,
} from './types';

export type SpeechRuntimeProbe = {
  reachable: boolean;
  reason?: string;
};

/**
 * Status-only probe. Does not load RVC/TTS models or convert audio.
 */
export async function probeSpeechRuntime(timeoutMs = 400): Promise<SpeechRuntimeProbe> {
  const base = getVoiceServiceBaseUrl();
  if (!base) {
    return { reachable: false, reason: 'No speech runtime URL is configured.' };
  }
  try {
    const response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.ok) return { reachable: true };
    return { reachable: false, reason: `Speech runtime HTTP ${response.status}` };
  } catch {
    return {
      reachable: false,
      reason: 'Speech runtime is not running; voice is selected but not active for speech.',
    };
  }
}

export class ProbeVoiceProfileResolver implements VoiceProfileResolver {
  constructor(private readonly probe: () => Promise<SpeechRuntimeProbe> = probeSpeechRuntime) {}

  public async resolve(profileId: string): Promise<VoiceProfileAvailability> {
    const known = profileId === JARVIS_VOICE_ID || profileId === GAM_VOICE_ID || profileId === ELEMISU_VOICE_ID;
    const runtime = await this.probe();
    return {
      profileId,
      selected: true,
      available: known && runtime.reachable,
      speechActive: false,
      reason: known
        ? (runtime.reachable
          ? 'Voice is selected. Speech runtime was not attached to this resolver.'
          : (runtime.reason || 'Speech runtime is not running; voice is selected but not active for speech.'))
        : `Unknown voice profile ${profileId}.`,
    };
  }
}

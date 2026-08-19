import { ELEMISU_VOICE_ID, GAM_VOICE_ID, JARVIS_VOICE_ID } from '../presentation/types';
import type { VoiceProfile, VoiceRouteKind } from './types';

export function speakerIdForProfile(profileId: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const normalized = profileId.trim().toLowerCase();
  if (normalized === GAM_VOICE_ID) return env.STANDALONE_GAM_SPEAKER_ID?.trim() || undefined;
  if (normalized === ELEMISU_VOICE_ID) return env.STANDALONE_ELEMISU_SPEAKER_ID?.trim() || undefined;
  const mapped = env.STANDALONE_VOICE_SPEAKERS?.split(',') || [];
  for (const entry of mapped) {
    const [id, speaker] = entry.split(':').map(part => part.trim());
    if (id?.toLowerCase() === normalized && speaker) return speaker;
  }
  return undefined;
}

export function resolveVoiceRoute(profileId: string, env: NodeJS.ProcessEnv = process.env): VoiceProfile {
  const id = profileId.trim().toLowerCase() || JARVIS_VOICE_ID;
  if (id === JARVIS_VOICE_ID) {
    return { profileId: JARVIS_VOICE_ID, kind: 'native', usesRvc: false };
  }
  const kind: VoiceRouteKind = 'clone';
  return {
    profileId: id,
    kind,
    usesRvc: true,
    speakerId: speakerIdForProfile(id, env),
  };
}

export function knownVoiceProfileIds(): string[] {
  return [JARVIS_VOICE_ID, GAM_VOICE_ID, ELEMISU_VOICE_ID];
}

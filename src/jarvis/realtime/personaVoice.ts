import { JARVIS_PERSONA_ID, JARVIS_VOICE_ID } from '../presentation/types';

/**
 * Persona and voice stay independent. Style cannot grant capability authority.
 */
export function assertIndependentPersonaVoice(input: {
  personaProfileId: string;
  voiceProfileId: string;
  previousPersonaProfileId?: string;
  previousVoiceProfileId?: string;
  changed: 'persona' | 'voice' | 'neither';
}): { personaUnchangedByVoice: boolean; voiceUnchangedByPersona: boolean; authorityUnchanged: true } {
  if (input.changed === 'voice') {
    return {
      personaUnchangedByVoice: input.personaProfileId === (input.previousPersonaProfileId ?? input.personaProfileId),
      voiceUnchangedByPersona: true,
      authorityUnchanged: true,
    };
  }
  if (input.changed === 'persona') {
    return {
      personaUnchangedByVoice: true,
      voiceUnchangedByPersona: input.voiceProfileId === (input.previousVoiceProfileId ?? input.voiceProfileId),
      authorityUnchanged: true,
    };
  }
  return { personaUnchangedByVoice: true, voiceUnchangedByPersona: true, authorityUnchanged: true };
}

export function defaultIndependentProfiles(): { personaProfileId: string; voiceProfileId: string } {
  return { personaProfileId: JARVIS_PERSONA_ID, voiceProfileId: JARVIS_VOICE_ID };
}

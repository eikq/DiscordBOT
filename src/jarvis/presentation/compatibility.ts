import type { MemoryDomain, PersonaMode, PresentationOverride, PresentationProfile, PresentationSessionState } from './types';
import { JARVIS_BRAIN_ID, JARVIS_PERSONA_ID, JARVIS_VOICE_ID } from './types';

/**
 * Live Discord still couples voice and persona through one map:
 * `BotService.activeVoiceSpeakers`. Both `/voice` and `/persona` write that map,
 * and `personaForGuild()` reads it. These helpers model the *new* independent
 * API plus a compatibility mapper. They do not change BotService.
 */
export const LEGACY_DISCORD_COUPLING = {
  stateField: 'BotService.activeVoiceSpeakers',
  commandsThatSetBoth: ['/voice', '/persona'] as const,
  personaLookup: 'personaForGuild reads the same guild map as the selected voice',
  independentApi: 'src/jarvis/presentation/compatibility.ts',
} as const;

export function defaultJarvisPresentation(): PresentationProfile {
  return {
    brainProfileId: JARVIS_BRAIN_ID,
    personaProfileId: JARVIS_PERSONA_ID,
    voiceProfileId: JARVIS_VOICE_ID,
    personaMode: 'NONE',
    language: 'auto',
    verbosity: 'short',
    humor: 'off',
  };
}

export function clonePresentation(profile: PresentationProfile): PresentationProfile {
  return { ...profile };
}

export function withVoice(profile: PresentationProfile, voiceProfileId: string): PresentationProfile {
  return { ...profile, voiceProfileId };
}

export function withPersona(
  profile: PresentationProfile,
  personaProfileId: string,
  personaMode: PersonaMode = personaProfileId === JARVIS_PERSONA_ID ? 'NONE' : 'STYLE',
): PresentationProfile {
  return { ...profile, personaProfileId, personaMode };
}

export function legacyVoiceCommandProfile(discordUserId: string): PresentationProfile {
  return {
    ...defaultJarvisPresentation(),
    personaProfileId: discordUserId,
    voiceProfileId: discordUserId,
    personaMode: 'SOCIAL',
  };
}

export function legacyPersonaCommandProfile(discordUserId: string): PresentationProfile {
  return legacyVoiceCommandProfile(discordUserId);
}

export function applyPresentationOverride(
  profile: PresentationProfile,
  override: PresentationOverride | undefined,
): PresentationProfile {
  const next = clonePresentation(profile);
  if (!override) return next;
  if (override.brainProfileId !== undefined) next.brainProfileId = override.brainProfileId;
  if (override.personaProfileId !== undefined) next.personaProfileId = override.personaProfileId;
  if (override.voiceProfileId !== undefined) next.voiceProfileId = override.voiceProfileId;
  if (override.personaMode !== undefined) next.personaMode = override.personaMode;
  if (override.language !== undefined) next.language = override.language;
  if (override.verbosity !== undefined) next.verbosity = override.verbosity;
  if (override.humor !== undefined) next.humor = override.humor;
  return next;
}

export function createPresentationSession(
  sessionId: string,
  profile: PresentationProfile = defaultJarvisPresentation(),
): PresentationSessionState {
  return {
    sessionId,
    defaultProfile: clonePresentation(profile),
    activeProfile: clonePresentation(profile),
  };
}

export function applySessionUpdate(
  state: PresentationSessionState,
  update: PresentationOverride,
): PresentationSessionState {
  return {
    ...state,
    activeProfile: applyPresentationOverride(state.activeProfile, update),
  };
}

export function resolveTurnProfile(
  state: PresentationSessionState,
  oneTurnOverride?: PresentationOverride,
): PresentationProfile {
  return applyPresentationOverride(state.activeProfile, oneTurnOverride);
}

export function memoryScopePersonaId(profile: PresentationProfile): string | undefined {
  if (profile.personaMode === 'NONE') return undefined;
  if (profile.personaProfileId === JARVIS_PERSONA_ID) return undefined;
  return profile.personaProfileId;
}

export function memoryDomainsFor(profile: PresentationProfile): MemoryDomain[] {
  const domains: MemoryDomain[] = ['global', 'discord'];
  if (memoryScopePersonaId(profile)) domains.push('persona');
  return domains;
}

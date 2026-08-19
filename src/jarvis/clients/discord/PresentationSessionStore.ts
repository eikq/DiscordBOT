import {
  applySessionUpdate,
  clonePresentation,
  createPresentationSession,
  defaultJarvisPresentation,
  legacyVoiceCommandProfile,
  memoryScopePersonaId,
  withPersona,
  withVoice,
} from '../../presentation/compatibility';
import { JARVIS_PERSONA_ID, JARVIS_VOICE_ID } from '../../presentation/types';
import type { PersonaMode, PresentationProfile, PresentationSessionState } from '../../presentation/types';

/**
 * Per-guild presentation session. Voice and persona are independent axes.
 * Live `/voice` and `/persona` still go through `applyLegacyVoiceAndPersona`.
 * This module must stay Discord.js-free.
 */
export class PresentationSessionStore {
  private readonly sessions = new Map<string, PresentationSessionState>();

  public applyLegacyVoiceAndPersona(guildId: string, discordUserId: string): PresentationProfile {
    return this.write(guildId, legacyVoiceCommandProfile(discordUserId));
  }

  public selectVoice(guildId: string, voiceProfileId: string): PresentationProfile {
    return this.write(guildId, withVoice(this.getProfile(guildId), voiceProfileId));
  }

  public selectPersona(
    guildId: string,
    personaProfileId: string,
    personaMode?: PersonaMode,
  ): PresentationProfile {
    const mode = personaMode ?? (personaProfileId === JARVIS_PERSONA_ID ? 'NONE' : 'STYLE');
    return this.write(guildId, withPersona(this.getProfile(guildId), personaProfileId, mode));
  }

  public resetToJarvis(guildId: string): PresentationProfile {
    return this.write(guildId, defaultJarvisPresentation());
  }

  public getProfile(guildId: string): PresentationProfile {
    const active = this.sessions.get(guildId)?.activeProfile;
    return active ? clonePresentation(active) : defaultJarvisPresentation();
  }

  public hasSession(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  public playbackSpeakerId(profile: PresentationProfile): string | undefined {
    if (!profile.voiceProfileId || profile.voiceProfileId === JARVIS_VOICE_ID) return undefined;
    return profile.voiceProfileId;
  }

  public behaviorPersonaId(profile: PresentationProfile): string | undefined {
    return memoryScopePersonaId(profile);
  }

  public clearMatchingUser(guildId: string, discordUserId: string): PresentationProfile | undefined {
    if (!this.hasSession(guildId)) return undefined;
    const profile = this.getProfile(guildId);
    let next = profile;
    if (profile.voiceProfileId === discordUserId) next = withVoice(next, JARVIS_VOICE_ID);
    if (profile.personaProfileId === discordUserId) next = withPersona(next, JARVIS_PERSONA_ID, 'NONE');
    return this.write(guildId, next);
  }

  private write(guildId: string, profile: PresentationProfile): PresentationProfile {
    const existing = this.sessions.get(guildId);
    const next = existing
      ? applySessionUpdate(existing, profile)
      : createPresentationSession(guildId, profile);
    this.sessions.set(guildId, next);
    return clonePresentation(next.activeProfile);
  }
}

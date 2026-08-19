import {
  applySessionUpdate,
  createPresentationSession,
  resolveTurnProfile,
} from './compatibility';
import {
  JARVIS_PERSONA_ID,
  type PresentationOverride,
  type PresentationProfile,
  type PresentationSessionState,
} from './types';

/**
 * Discord-free in-memory presentation sessions for standalone Jarvis.
 * Voice and persona are independent; one-turn overrides do not persist.
 */
export class StandalonePresentationSessions {
  private readonly sessions = new Map<string, PresentationSessionState>();

  public get(sessionId: string): PresentationSessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) return cloneState(existing);
    const created = createPresentationSession(sessionId);
    this.sessions.set(sessionId, created);
    return cloneState(created);
  }

  public selectPersona(sessionId: string, personaProfileId: string): PresentationSessionState {
    const current = this.get(sessionId);
    const personaMode = personaProfileId === JARVIS_PERSONA_ID ? 'NONE' : 'STYLE';
    const next = applySessionUpdate(current, { personaProfileId, personaMode });
    this.sessions.set(sessionId, next);
    return cloneState(next);
  }

  public selectVoice(sessionId: string, voiceProfileId: string): PresentationSessionState {
    const current = this.get(sessionId);
    const next = applySessionUpdate(current, { voiceProfileId });
    this.sessions.set(sessionId, next);
    return cloneState(next);
  }

  public resolveTurn(sessionId: string, oneTurnOverride?: PresentationOverride): PresentationProfile {
    return resolveTurnProfile(this.get(sessionId), oneTurnOverride);
  }
}

function cloneState(state: PresentationSessionState): PresentationSessionState {
  return {
    sessionId: state.sessionId,
    defaultProfile: { ...state.defaultProfile },
    activeProfile: { ...state.activeProfile },
    ...(state.expiresAt ? { expiresAt: state.expiresAt } : {}),
  };
}

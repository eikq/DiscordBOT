import type { SocialDecision } from '../../../bot/brain/types';
import type { GroupConversationState } from '../../../bot/brain/GroupConversationState';
import type { PersonaProfile } from '../../../bot/personality/PersonaProfileManager';
import { ResponseGenerator } from '../../../bot/personality/ResponseGenerator';
import type { JarvisCoreResult } from '../../core/types';
import { FactPreservingPresentationEngine, type PresentationEngine } from '../../presentation/PresentationEngine';
import { defaultJarvisPresentation, legacyVoiceCommandProfile, memoryScopePersonaId } from '../../presentation/compatibility';
import { ensureImmutableFacts, immutableFacts } from '../../presentation/facts';
import type { PresentationContext, PresentationProfile, PresentedResponse } from '../../presentation/types';

export type LegacyTurnInput = {
  sessionId: string;
  decision: SocialDecision;
  state: GroupConversationState;
  persona?: PersonaProfile | null;
  memoryContext?: string;
  profile?: PresentationProfile;
  result?: JarvisCoreResult;
};

function placeholderResult(requestId: string): JarvisCoreResult {
  return {
    requestId,
    answerIntent: 'legacy_generate',
    verifiedFacts: [],
    unverifiedClaims: [],
    toolResults: [],
    memoryRefs: [],
    actionResults: [],
    uncertainty: [],
    suggestedContent: '',
  };
}

/**
 * Wraps Digital Me `ResponseGenerator` behind the presentation boundary.
 *
 * Live Discord should pass the guild `PresentationProfile` so independent
 * voice/persona selection is honored. If the caller omits `profile`, the engine
 * falls back to `legacyVoiceCommandProfile(persona.userId)`. Voice-only profiles
 * must not pass a cloned persona into `ResponseGenerator`.
 */
export class ResponseGeneratorPresentationEngine implements PresentationEngine {
  private readonly factEngine = new FactPreservingPresentationEngine();

  constructor(private readonly generator: ResponseGenerator = new ResponseGenerator()) {}

  public async presentLegacyTurn(input: LegacyTurnInput): Promise<PresentedResponse | null> {
    if (input.decision.action === 'IGNORE' || input.decision.action === 'LISTEN') return null;
    const profile = input.profile ?? this.legacyProfile(input.persona);
    const result = input.result ?? placeholderResult(input.sessionId);
    const presented = await this.renderLegacy(result, profile, input);
    return presented.text ? presented : null;
  }

  public async render(
    result: JarvisCoreResult,
    profile: PresentationProfile,
    context: PresentationContext,
  ): Promise<PresentedResponse> {
    return this.factEngine.render(result, profile, context);
  }

  private async renderLegacy(
    result: JarvisCoreResult,
    profile: PresentationProfile,
    input: LegacyTurnInput,
  ): Promise<PresentedResponse> {
    const transformations: string[] = [];
    const scopedPersona = this.personaForProfile(profile, input.persona);
    if (immutableFacts(result).length > 0 && result.suggestedContent.trim()) {
      const styled = await this.factEngine.render(result, profile, { sessionId: input.sessionId });
      transformations.push('structured-facts-skip-legacy-generate');
      return {
        ...styled,
        transformations: [...styled.transformations, ...transformations],
      };
    }

    const generated = await this.generator.generate(
      input.decision,
      input.state,
      scopedPersona,
      input.memoryContext ?? '',
    );
    transformations.push(scopedPersona
      ? `legacy-response-generator:${scopedPersona.userId}`
      : 'legacy-response-generator:no-persona');
    transformations.push(`voice:${profile.voiceProfileId}:selected-not-loaded`);

    const before = (generated ?? result.suggestedContent).trim();
    const text = ensureImmutableFacts(before, result);
    if (text !== before) transformations.push('restored-immutable-facts');

    return {
      text,
      personaProfileId: profile.personaProfileId,
      voiceProfileId: profile.voiceProfileId,
      transformations,
      behaviorPersonaId: memoryScopePersonaId(profile) || scopedPersona?.userId,
    };
  }

  private personaForProfile(
    profile: PresentationProfile,
    persona: PersonaProfile | null | undefined,
  ): PersonaProfile | null {
    const scopeId = memoryScopePersonaId(profile);
    if (!scopeId) return null;
    if (!persona) return null;
    if (persona.userId !== scopeId) return null;
    return persona;
  }

  private legacyProfile(persona: PersonaProfile | null | undefined): PresentationProfile {
    return persona ? legacyVoiceCommandProfile(persona.userId) : defaultJarvisPresentation();
  }
}

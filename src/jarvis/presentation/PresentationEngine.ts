import type { JarvisCoreResult } from '../core/types';
import type { AffectStyle } from '../evolution/affect';
import { overlayIdentity } from '../evolution/identity';
import { memoryScopePersonaId } from './compatibility';
import { presentationContradictsFacts, styleSuggestedContent } from './facts';
import { JARVIS_PERSONA_ID, JARVIS_VOICE_ID } from './types';
import type {
  PersonaProvider,
  PresentationContext,
  PresentationProfile,
  PresentedResponse,
  VoiceProfileResolver,
} from './types';

export interface PresentationEngine {
  render(
    result: JarvisCoreResult,
    profile: PresentationProfile,
    context: PresentationContext,
  ): Promise<PresentedResponse>;
}

export type FactPreservingPresentationEngineOptions = {
  persona?: PersonaProvider;
  voices?: VoiceProfileResolver;
  affectStyle?: AffectStyle | (() => AffectStyle | undefined);
};

/**
 * Style-only renderer for contract tests and structured Core results.
 * Does not wrap ResponseGenerator, does not call tools, and does not load TTS/RVC.
 */
export class FactPreservingPresentationEngine implements PresentationEngine {
  constructor(private readonly options: FactPreservingPresentationEngineOptions = {}) {}

  public async render(
    result: JarvisCoreResult,
    profile: PresentationProfile,
    _context: PresentationContext,
  ): Promise<PresentedResponse> {
    const transformations: string[] = [];
    const usesPersona = profile.personaMode !== 'NONE' && profile.personaProfileId !== JARVIS_PERSONA_ID;
    const affect = resolveAffect(this.options.affectStyle);
    let slang = usesPersona ? 'แบบนี้ไง ' : '';
    if (affect && affect.formality > 0.65) {
      slang = '';
      transformations.push('affect:formal');
    }
    if (affect) {
      overlayIdentity({
        personaId: profile.personaProfileId,
        affectStyle: { warmth: affect.warmth, formality: affect.formality },
      });
      transformations.push(`affect:style:${affect.responseLength}:${affect.voiceEnergy}`);
    }
    if (usesPersona) transformations.push(`persona:${profile.personaProfileId}:${profile.personaMode}`);
    if (profile.voiceProfileId) transformations.push(`voice:${profile.voiceProfileId}:selected-not-loaded`);

    if (usesPersona && this.options.persona) {
      const examples = await this.options.persona.getBehaviorExamples(
        profile.personaProfileId,
        result.suggestedContent,
        3,
      );
      transformations.push(`persona:${profile.personaProfileId}:examples:${examples.length}`);
    }

    if (this.options.voices) {
      const voice = await this.options.voices.resolve(profile.voiceProfileId || JARVIS_VOICE_ID);
      transformations.push(
        voice.speechActive
          ? `voice:${voice.profileId}:speech-active`
          : `voice:${voice.profileId}:speech-inactive`,
      );
    }

    let text = styleSuggestedContent(result, slang);
    if (presentationContradictsFacts(text, result).length > 0) {
      text = styleSuggestedContent(result, slang);
      transformations.push('restored-immutable-facts');
    }

    return {
      text,
      personaProfileId: profile.personaProfileId,
      voiceProfileId: profile.voiceProfileId,
      transformations,
      behaviorPersonaId: memoryScopePersonaId(profile),
    };
  }
}

function resolveAffect(value?: AffectStyle | (() => AffectStyle | undefined)): AffectStyle | undefined {
  return typeof value === 'function' ? value() : value;
}

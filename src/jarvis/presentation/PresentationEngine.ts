import type { JarvisCoreResult } from '../core/types';
import { memoryScopePersonaId } from './compatibility';
import { presentationContradictsFacts, styleSuggestedContent } from './facts';
import { JARVIS_PERSONA_ID } from './types';
import type { PresentationContext, PresentationProfile, PresentedResponse } from './types';

export interface PresentationEngine {
  render(
    result: JarvisCoreResult,
    profile: PresentationProfile,
    context: PresentationContext,
  ): Promise<PresentedResponse>;
}

/**
 * Style-only renderer for contract tests. Does not wrap ResponseGenerator,
 * does not call tools, and does not load TTS/RVC.
 */
export class FactPreservingPresentationEngine implements PresentationEngine {
  public async render(
    result: JarvisCoreResult,
    profile: PresentationProfile,
    _context: PresentationContext,
  ): Promise<PresentedResponse> {
    const transformations: string[] = [];
    const usesPersona = profile.personaMode !== 'NONE' && profile.personaProfileId !== JARVIS_PERSONA_ID;
    const slang = usesPersona ? 'แบบนี้ไง ' : '';
    if (usesPersona) transformations.push(`persona:${profile.personaProfileId}:${profile.personaMode}`);
    if (profile.voiceProfileId) transformations.push(`voice:${profile.voiceProfileId}:selected-not-loaded`);

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

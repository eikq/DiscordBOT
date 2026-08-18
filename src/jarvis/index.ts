export type {
  ActionResult,
  Claim,
  JarvisClientContext,
  JarvisClientSource,
  JarvisCore,
  JarvisCoreResult,
  JarvisRequest,
  JarvisResponse,
  MemoryRef,
  ReasoningResult,
  ToolResultRef,
  VerifiedFact,
} from './core/types';
export { PassThroughJarvisCore, UnavailableJarvisCore } from './core/JarvisCore';
export type {
  BehaviorExample,
  InvocationResolution,
  JarvisPersonaProfile,
  MemoryDomain,
  PersonaMode,
  PersonaProvider,
  PresentationContext,
  PresentationHumor,
  PresentationLanguage,
  PresentationOverride,
  PresentationProfile,
  PresentationSessionState,
  PresentationVerbosity,
  PresentedResponse,
  VoiceProfileAvailability,
  VoiceProfileResolver,
} from './presentation/types';
export {
  JARVIS_BRAIN_ID,
  JARVIS_PERSONA_ID,
  JARVIS_VOICE_ID,
} from './presentation/types';
export type { PresentationEngine } from './presentation/PresentationEngine';
export { FactPreservingPresentationEngine } from './presentation/PresentationEngine';
export {
  LEGACY_DISCORD_COUPLING,
  applyPresentationOverride,
  applySessionUpdate,
  clonePresentation,
  createPresentationSession,
  defaultJarvisPresentation,
  legacyPersonaCommandProfile,
  legacyVoiceCommandProfile,
  memoryDomainsFor,
  memoryScopePersonaId,
  resolveTurnProfile,
  withPersona,
  withVoice,
} from './presentation/compatibility';
export { immutableFacts, presentationContradictsFacts, styleSuggestedContent } from './presentation/facts';

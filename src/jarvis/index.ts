export type {
  ActionResult,
  ActionResultStatus,
  CapabilityCall,
  Claim,
  JarvisClientContext,
  JarvisClientSource,
  JarvisCore,
  JarvisCoreResult,
  JarvisRequest,
  JarvisResponse,
  MemoryRef,
  ReasoningResult,
  SkillRef,
  ToolResultRef,
  VerifiedFact,
} from './core/types';
export { PassThroughJarvisCore, UnavailableJarvisCore } from './core/JarvisCore';
export { createJarvisRequest } from './core/request';
export { JarvisMemoryRetrieval, fuseMemoryRetrieval } from './memory';
export type {
  CompactMemoryItem,
  JarvisMemoryService,
  MemoryRetrievalQuery,
  MemoryTurnContext,
  MemoryTurnQuery,
  RetrievedMemory,
} from './memory';
export type { CreateJarvisRequestInput } from './core/request';
export {
  JarvisSkillRuntime,
  UnavailableJarvisSkillRuntime,
  createJarvisSkillRuntime,
  loadDefaultJarvisSkillRuntime,
} from './skills';
export type {
  ActivatedJarvisSkill,
  JarvisSkillActivationRequest,
  JarvisSkillActivationResult,
  JarvisSkillAllowlistConfig,
  JarvisSkillAllowlistEntry,
  JarvisSkillCatalog,
  JarvisSkillHost,
  JarvisSkillMetadata,
  JarvisSkillTrust,
} from './skills';
export { LocalLlmJarvisCore } from './standalone/LocalLlmJarvisCore';
export type { LocalLlmJarvisCoreOptions, StandaloneLlm, TimedCoreResult } from './standalone/LocalLlmJarvisCore';
export { applyJarvisInteractiveProfile, describeJarvisRuntimeProfile } from './standalone/runtimeProfile';
export { defaultRuntimeSpec, RuntimeSpecRegistry, diffRuntimeSpec } from './standalone/runtimeSpec';
export type { JarvisRuntimeSpec } from './standalone/runtimeSpec';
export { compactTurnTimings } from './standalone/turnTimings';
export type { TurnTimings, LlmTurnMetrics } from './standalone/turnTimings';
export {
  CapabilityRegistry,
  WORLD_INTEL_CAPABILITY_PREFIX,
  WORLD_INTEL_OUTPUT_SCHEMA,
  WORLD_INTEL_SERVICE,
  LAB_PING_CAPABILITY_ID,
  capabilityResultToToolRef,
  createLabPingHandler,
  createStandaloneCapabilityHost,
  createWorldIntelCapabilityHandler,
  ensureUntrustedWrapper,
  isWorldIntelReadOnlyTool,
  registerWorldIntelCapabilities,
  worldIntelCapabilityId,
  ActionAuditLog,
  ConfirmationStore,
  PermissionPolicy,
  WindowsDesktopActionAdapter,
  blockedActionResult,
  capabilityResultToActionResult,
  createActionGate,
  inferActionIntent,
  isActionHost,
  isActionFastPathId,
  isExplicitActionConfirmation,
  isGatedCapabilityId,
  loadDesktopAllowlists,
  validateActionInput,
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SETTINGS,
  DESKTOP_OPEN_TRUSTED_URL,
  DESKTOP_FOCUS_JARVIS_WINDOW,
  DESKTOP_GET_JARVIS_WINDOW,
  DESKTOP_LIST_DISPLAYS,
  DESKTOP_MOVE_JARVIS_WINDOW,
  DESKTOP_SET_JARVIS_LAYOUT,
  DESKTOP_SET_JARVIS_WINDOW_BOUNDS,
  SYSTEM_STATUS,
  JARVIS_RUNTIME_STATUS,
  JARVIS_START_SERVICE,
  REMINDERS_CREATE,
  REMINDERS_LIST,
} from './capabilities';
export type {
  CapabilityAvailability,
  CapabilityAvailabilityState,
  CapabilityDescriptor,
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvokeRequest,
  CapabilityInvokeStatus,
  CapabilityProviderKind,
  CapabilityResult,
  CapabilitySideEffect,
  JsonSchema,
  WorldIntelCapabilityPort,
  WorldIntelExecuteResult,
  StandaloneCapabilityHostOptions,
  ActionHost,
  ActionRisk,
  DesktopAllowlists,
  PendingConfirmation,
  PermissionDecision,
} from './capabilities';
export { runStandaloneTextTurn, standalonePresentation } from './standalone/textHarness';
export type { StandaloneTextTurnInput, StandaloneTextTurnOutput } from './standalone/textHarness';
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
  GAM_PERSONA_ID,
  GAM_VOICE_ID,
  ELEMISU_VOICE_ID,
} from './presentation/types';
export type { PresentationEngine } from './presentation/PresentationEngine';
export {
  applyBriefingFollowUp,
  applySpokenDuration,
  buildMotionTimeline,
  estimateNarrationMs,
  FORBIDDEN_PRESENTATION_KEYS,
  planPresentation,
  presentationHasForbiddenKeys,
  runPresentationPipeline,
  sanitizePlannedPresentation,
  spokenTextFor,
} from './presentation/briefing';
export type { PlannedPresentation, PresentationModel } from './presentation/briefing';
export { FactPreservingPresentationEngine } from './presentation/PresentationEngine';
export { FileBehaviorPersonaProvider } from './presentation/filePersonaProvider';
export { StandalonePresentationSessions } from './presentation/standaloneSession';
export { ProbeVoiceProfileResolver, probeSpeechRuntime } from './presentation/voiceAvailability';
export {
  StandaloneVoiceRouter,
  StandaloneVoiceResourcePolicy,
  RouterVoiceResolver,
  MemoryCloneConsent,
  resolveVoiceRoute,
  shouldUseJaitts,
  TurnGate,
} from './speech';
export type {
  VoiceOutputRouter,
  VoiceOutputResult,
  VoiceProfile,
  VoiceTurnContext,
} from './speech';
export {
  SpeechTurnController,
  createSpeechJarvisRequest,
  describeBusyPolicy,
  transcribeStandaloneUtterance,
} from './audio';
export type { AudioInput, SpeechTurn, StandaloneTranscriptResult } from './audio';
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
export { ensureImmutableFacts, immutableFacts, presentationContradictsFacts, styleSuggestedContent } from './presentation/facts';
export { ResponseGeneratorPresentationEngine } from './clients/discord/ResponseGeneratorPresentationEngine';
export type { LegacyTurnInput } from './clients/discord/ResponseGeneratorPresentationEngine';
export { PresentationSessionStore } from './clients/discord/PresentationSessionStore';
export { DiscordJarvisAdapter } from './clients/discord/DiscordJarvisAdapter';
export type { DiscordJarvisTurnInput, DiscordJarvisTurnResult } from './clients/discord/DiscordJarvisAdapter';
export {
  FakeClock,
  ReminderStore,
  createReminderRuntime,
  inferReminderIntent,
  parseScheduleText,
  reminderTextAsData,
} from './automation';
export type { ReminderRecord, ReminderRuntime, TimeTrigger } from './automation';
export {
  RESEARCH_CURRENT,
  RESEARCH_PRIVATE_BROWSE,
  RESEARCH_SEARCH,
  classifyResearchUrl,
  createResearchRuntime,
  inferResearchIntent,
  isResearchCapabilityId,
  webpageTextAsData,
  PrivateResearchGateway,
  assertDedicatedChromium,
  interpretWebContent,
  planResearchDepth,
  webContentMayInvokeCapability,
  webContentMayReadHostFilesystem,
  webContentMayRequestPrivilege,
} from './research';
export {
  PrivilegeLeaseStore,
  JarvisEventBus,
  sharedJarvisEventBus,
  probeHostSecurity,
  capabilityRequiresLease,
  isForbiddenGenericShell,
  redactSecrets,
} from './security';
export {
  ExperienceStore,
  reflectOnExperience,
  SkillVersionRegistry,
  createCandidateSandbox,
  rejectProductionWrite,
  resolveMemoryContradiction,
  ClaimStore,
  reflectStructured,
  FailureLedger,
  CapabilitySelfModel,
  GrowthPlanner,
  PracticeEngine,
  BenchmarkBank,
  NightCycle,
  AffectEngine,
  CandidateManager,
  RuntimeSpecOptimizer,
  ModelAdaptationRegistry,
  buildJournal,
  buildEvolutionGraph,
  affectCannotAuthorize,
  applyTaskOutcome,
} from './evolution';
export { WorkAgent, WorkTaskStore, assertAcyclic, defaultPlanFor, planForObjective, createCapabilityWorkInvoker, synthesizeTaskResponse } from './agent';
export { visualStateFromEvents, visualStateFromEvent, formatSseEvent, parseLastEventId, sseCursorFrom, writeSseReplay, mergeBudgets, classifyFailure, TraceStore, TraceAnalyzer, ANALYZER_INSUFFICIENT, FORBIDDEN_TRACE_KEYS, efficiencyFromTraces, auditSchedulers, scheduledJobIsNotPermission, authorizeAtExecution } from './ops';
export { ModelProfileRegistry, CapabilityCertificationBank, routeModelProfile, catalogModelProfiles, modelMayNotAuthorize, realModelCertificationBlocked } from './models';
export { ArtifactWorkflow } from './artifacts';
export { SimulatedMediaProvider, mediaStageList, neverAutoPublish, requestPublish, MONEY_PRINTER_TURBO } from './media';
export { THAI_COMBINING_FIXTURE } from './i18n/thaiIntegrity';
export { OwnerControl } from './control';
export { ProactiveMonitor } from './monitor';
export { SimulatedDeviceProvider } from './devices';
export { SimulatedVisionAnalyzer, visionActionAllowed } from './vision';
export { CommandCenterRuntime, sharedCommandCenter, resetSharedCommandCenter } from './standalone/commandCenter';
export type { CommandCenterSnapshot } from './standalone/commandCenter';
export type { DemoScenarioId } from './standalone/commandCenterHttp';
export { presentCommandCenter } from './standalone/commandCenterView';
export {
  inferDesktopPresenceIntent,
  JarvisPresenceStore,
  sharedJarvisPresenceStore,
  FakeNativeJarvisHelper,
  parseNativeHelperRequest,
  NATIVE_HELPER_PROTOCOL_VERSION,
} from './desktop';
export type { CommandCenterClientSnapshot } from './standalone/commandCenterView';
export {
  parseDemoScenario,
  parseControlPatch,
  applyOwnerControl,
  parseTaskId,
  parseObjective,
  parseNightAction,
  parsePermissionGrant,
  DEMO_SCENARIOS,
} from './standalone/commandCenterHttp';
export {
  classifyActionability,
  compactCapabilityCatalog,
  resolveUserIntent,
  validateIntentResolution,
  InteractionContextStore,
  routeJarvisRequest,
  shouldUseWorkAgent,
  classifyComparisonIntent,
} from './intent';
export type { IntentResolution, InteractionContext, CompactCapability, RouteDecision, JarvisRequestRoute } from './intent';
export type { ResearchResult, ResearchRuntime, ResearchSnapshot, SourceRecord } from './research';
export {
  WORKSPACE_CURRENT,
  WORKSPACE_SEARCH,
  createWorkspaceRuntime,
  inferWorkspaceIntent,
  isWorkspaceCapabilityId,
  loadWorkspaceRegistry,
} from './workspace';
export type { WorkspaceResult, WorkspaceRuntime, WorkspaceSnapshot } from './workspace';

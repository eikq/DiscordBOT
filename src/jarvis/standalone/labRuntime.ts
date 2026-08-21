import { LocalLlmProvider } from '../../bot/llm/LocalLlmProvider';
import { SqliteJarvisMemoryStore } from '../../bot/memory/jarvis/SqliteJarvisMemoryStore';
import { LocalSTTProvider } from '../../bot/stt/LocalSTTProvider';
import type { SpeechToTextProvider } from '../../bot/stt/SpeechToTextProvider';
import { createSpeechJarvisRequest } from '../audio/speechTurnRequest';
import { getStandaloneSttBaseUrl, type SttRuntimeProbe } from '../audio/sttAvailability';
import { durationMsOfPcm, toSttStereoPcm } from '../audio/pcm';
import { STT_PCM_CHANNELS, STT_PCM_SAMPLE_RATE } from '../audio/types';
import { transcribeStandaloneUtterance, type StandaloneTranscriptResult } from '../audio/transcribeUtterance';
import type { ReminderRuntime } from '../automation';
import { trySharedReminderRuntime } from '../automation';
import type { ReminderSnapshot } from '../automation/types';
import type { ResearchRuntime, ResearchSnapshot } from '../research';
import { trySharedResearchRuntime } from '../research';
import { isResearchResult, researchFactsFromResult } from '../research/researchFacts';
import type { WorkspaceRuntime, WorkspaceSnapshot } from '../workspace';
import { trySharedWorkspaceRuntime } from '../workspace';
import { probeHostSecurity } from '../security/hostBaseline';
import { sharedJarvisEventBus } from '../security/eventBus';
import { PrivateResearchGateway } from '../research/private/privateGateway';
import type { HostSecuritySnapshot } from '../security/types';
import type { PrivateRouteHealth } from '../research/private/types';
import {
  configuredLocalModelProfile,
  ModelCertificationRegistry,
  ModelProfileRegistry,
  type ModelProfile,
} from '../models';
import {
  CapabilityGapResolver,
  answerFromSelfKnowledge,
  buildSelfKnowledgeSnapshot,
  resolveCapabilityGoal,
  resolveSelfKnowledgeGap,
  selfKnowledgeQuestionKind,
  type SelfKnowledgeAnswer,
  type SelfKnowledgeSnapshot,
} from '../intelligence';
import { CCTV_CONNECT_GOAL, cctvCapabilityContracts } from '../devices';
import { isWorkspaceResult, workspaceFactsFromResult } from '../workspace/workspaceFacts';
import {
  ActionAuditLog,
  blockedActionResult,
  capabilityResultToActionResult,
  configuredApplicationIds,
  configuredProjectIds,
  defaultActionAuditPath,
  freezeActionResults,
  isActionFastPathId,
  isActionHost,
  loadDesktopAllowlists,
  type PendingConfirmation,
} from '../capabilities/actions';
import {
  clarificationActionResult,
  compactCapabilityCatalog,
  intentStageOf,
  InteractionContextStore,
  newClarificationId,
  resolveUserIntent,
  runSemanticResolver,
  unsupportedActionResult,
  type IntentResolution,
} from '../intent';
import { isUnavailableAction } from '../intent/results';
import { capabilityResultToToolRef } from '../capabilities/CapabilityRegistry';
import { createStandaloneCapabilityHost } from '../capabilities/standaloneHost';
import type { CapabilityHost, CapabilityProviderKind } from '../capabilities/types';
import { createJarvisRequest } from '../core/request';
import type { ActionResult, JarvisCore, JarvisCoreResult } from '../core/types';
import { JarvisMemoryRetrieval } from '../memory/retrieval';
import type { JarvisMemoryService } from '../memory/service';
import {
  forgetOwnerAlias,
  formatAliasAnswer,
  listOwnerAliases,
  rememberOwnerAlias,
  rememberOwnerPreference,
} from '../memory/ownerSemantics';
import { applyOpenedResource } from '../memory/workingContext';
import { mergeResearchIntoContext, sourcesFromResearch } from '../memory/activeContext';
import { describeDisplays, fingerprintDisplay, serializeDisplayFingerprint } from '../desktop/displayIdentity';
import { enumerateWindowsDisplays, inspectAllowlistedWindow, processNameForApplication, processNameForUrl, processNamesForUrl } from '../desktop/windowsDisplayHost';
import { classifyWindowOnDisplays } from '../desktop/windowPlacement';
import { evidenceFromWindowInspection, reconcileContainment } from '../safety/containmentReconcile';
import { sharedTrustedOperatorRuntime } from '../security/trustedOperatorRuntime';
import { preferredLanguage, speakInLanguage } from '../intent/conversationLanguage';
import { resolveRegisteredWorkspace } from '../resources/workspaceAuthority';
import { loadWorkspaceRegistry } from '../workspace/registry';
import type { JarvisMemoryStore } from '../../bot/memory/jarvis/store';
import { loadDefaultJarvisSkillRuntime } from '../skills';
import type { JarvisSkillHost } from '../skills';
import { JARVIS_BRAIN_ID, JARVIS_PERSONA_ID, JARVIS_VOICE_ID } from '../presentation/types';
import type { InteractionContext } from '../intent/types';
import type {
  PersonaProvider,
  PresentationOverride,
  PresentationSessionState,
  VoiceProfileAvailability,
  VoiceProfileResolver,
} from '../presentation/types';
import { FileBehaviorPersonaProvider } from '../presentation/filePersonaProvider';
import { FactPreservingPresentationEngine } from '../presentation/PresentationEngine';
import { StandalonePresentationSessions } from '../presentation/standaloneSession';
import { ProbeVoiceProfileResolver } from '../presentation/voiceAvailability';
import { RouterVoiceResolver, StandaloneVoiceRouter } from '../speech';
import type { VoiceOutputResult, VoiceOutputRouter } from '../speech';
import { classifySpeechEvent, decideSpeech, type SpeechMode } from '../speech/speechPolicy';
import { isDuplicateUtterance, shapeSpokenText } from '../speech/speechShape';
import { LocalLlmJarvisCore, type StandaloneLlm } from './LocalLlmJarvisCore';
import { describeJarvisRuntimeProfile, type JarvisRuntimeProfile } from './runtimeProfile';
import { runStandaloneTextTurn, type StandaloneTextTurnOutput } from './textHarness';
import { CommandCenterRuntime, sharedCommandCenter } from './commandCenter';
import { routeJarvisRequest, shouldUseWorkAgent, type RouteDecision } from '../intent/requestRouter';
import { synthesizeTaskResponse } from '../agent/synthesize';
import type { SynthesizedTaskResponse } from '../agent/types';
import type { AffectStyle } from '../evolution/affect';
import type { PendingGoalContinuation, PendingGoalRecord } from '../goals';
import type { WorkTask } from '../agent/types';

export type JarvisLabAskInput = {
  text: string;
  sessionId?: string;
  personaProfileId?: string;
  voiceProfileId?: string;
  oneTurn?: boolean;
  capabilities?: string[];
  capabilityCalls?: Array<{
    id: string;
    input?: Record<string, unknown>;
    confirmation?: { proposalId: string; token: string };
  }>;
  speak?: boolean;
  actionSource?: 'text' | 'voice' | 'ui' | 'system';
  continuation?: {
    pendingGoalId?: string;
    idempotencyKey?: string;
    explicitSelection?: boolean;
  };
};

export type JarvisLabPresentationStatus = {
  sessionId: string;
  brain: { id: string; available: true };
  persona: { id: string; available: boolean; mode: string };
  voice: VoiceProfileAvailability;
  session: PresentationSessionState;
};

export type JarvisLabStatus = {
  discordRequired: false;
  ready: boolean;
  coreState: 'idle' | 'ready' | 'degraded';
  memory: {
    attached: boolean;
    schemaVersion?: number;
  };
  capabilities: {
    attached: boolean;
    ids: string[];
    catalog: Array<{
      id: string;
      description: string;
      providerKind: CapabilityProviderKind;
      untrustedOutput: boolean;
      requiredService: string;
      sideEffect: 'read' | 'write';
    }>;
  };
  presentation: JarvisLabPresentationStatus;
  llm?: {
    enabled?: boolean;
    reachable?: boolean;
    model?: string;
    provider?: 'ollama' | 'openai-compatible';
    profile?: ModelProfile;
  };
  stt: SttRuntimeProbe;
  runtime?: JarvisRuntimeProfile;
  speech?: {
    attached: boolean;
    outputDevice: 'default';
    resource: { phase: string; unload: string; qwen?: string; asr?: string; jaitts?: string; rvc?: string };
  };
  services?: Array<{
    id: string;
    displayName: string;
    health: string;
    lifecycle: string;
    reason?: string;
    startAllowed: boolean;
    stopAllowed: boolean;
    restartAllowed: boolean;
  }>;
  reminders?: {
    attached: boolean;
    healthy: boolean;
    timezone?: string;
    nextRunAt?: string | null;
    activeCount?: number;
    pendingCount?: number;
    reason?: string;
  };
  research?: {
    attached: boolean;
    healthy: boolean;
    reason?: string;
  };
  workspace?: {
    attached: boolean;
    healthy: boolean;
    reason?: string;
    documentCount?: number;
    indexStatus?: string;
  };
  operations?: Array<{ type: string; at: string; summary: string; level: string }>;
  privateBrowser?: {
    available: boolean;
    reasonCode: string;
    detail: string;
  };
  selfKnowledge?: SelfKnowledgeSnapshot;
};

export type JarvisLabRuntimeOptions = {
  core?: JarvisCore;
  memory?: JarvisMemoryService;
  memoryStore?: JarvisMemoryStore;
  memorySchemaVersion?: number;
  capabilities?: CapabilityHost;
  skills?: JarvisSkillHost;
  persona?: PersonaProvider;
  voices?: VoiceProfileResolver;
  llm?: StandaloneLlm & { getRuntimeStatus?: () => Promise<{ enabled?: boolean; reachable?: boolean; model?: string; provider?: 'ollama' | 'openai-compatible' }> };
  attachDefaultMemory?: boolean;
  attachDefaultCapabilities?: boolean;
  attachDefaultSkills?: boolean;
  attachDefaultPresentation?: boolean;
  stt?: SpeechToTextProvider;
  probeStt?: () => Promise<SttRuntimeProbe>;
  speech?: VoiceOutputRouter;
  attachDefaultSpeech?: boolean;
  reminders?: ReminderRuntime | false;
  research?: ResearchRuntime | false;
  workspace?: WorkspaceRuntime | false;
  commandCenter?: CommandCenterRuntime | false;
  modelProfiles?: ModelProfileRegistry;
  modelCertifications?: ModelCertificationRegistry;
};

export class JarvisLabRuntime {
  private readonly core: JarvisCore;
  private readonly llm?: JarvisLabRuntimeOptions['llm'];
  private readonly memoryAttached: boolean;
  private readonly memorySchemaVersion?: number;
  private readonly memoryStore?: JarvisMemoryStore;
  private readonly capabilityIds: string[];
  private readonly capabilityHost?: CapabilityHost;
  private readonly sessions = new StandalonePresentationSessions();
  private readonly persona?: PersonaProvider;
  private readonly voices?: VoiceProfileResolver;
  private readonly engine: FactPreservingPresentationEngine;
  private readonly stt: SpeechToTextProvider;
  private readonly probeStt: () => Promise<SttRuntimeProbe>;
  private readonly speech?: VoiceOutputRouter;
  private lastSpoken = '';
  private speechMode: SpeechMode = 'normal';
  private readonly applicationIds: string[];
  private readonly projectIds: string[];
  private readonly reminders?: ReminderRuntime;
  private readonly research?: ResearchRuntime;
  private readonly workspace?: WorkspaceRuntime;
  private readonly intents = new InteractionContextStore();
  private commandCenter?: CommandCenterRuntime;
  private readonly modelProfiles: ModelProfileRegistry;
  private readonly modelCertifications: ModelCertificationRegistry;

  constructor(options: JarvisLabRuntimeOptions = {}) {
    const attached = options.memory
      ? { service: options.memory, store: undefined as SqliteJarvisMemoryStore | undefined, schemaVersion: options.memorySchemaVersion }
      : options.attachDefaultMemory
        ? tryDefaultMemory()
        : undefined;
    this.reminders = options.reminders === false
      ? undefined
      : options.reminders ?? (options.attachDefaultCapabilities ? trySharedReminderRuntime({ start: true }) : undefined);
    this.research = options.research === false
      ? undefined
      : options.research ?? (options.attachDefaultCapabilities ? trySharedResearchRuntime() : undefined);
    this.workspace = options.workspace === false
      ? undefined
      : options.workspace ?? (options.attachDefaultCapabilities ? trySharedWorkspaceRuntime({ research: this.research }) : undefined);
    const memoryStore = options.memoryStore ?? attached?.store;
    const capabilities = options.capabilities
      ?? (options.attachDefaultCapabilities ? createStandaloneCapabilityHost({
        reminders: this.reminders,
        research: this.research ? { runtime: this.research } : undefined,
        workspace: this.workspace ? { runtime: this.workspace } : undefined,
        actions: {
          displayAliases: () => listOwnerAliases(memoryStore, 'display'),
        },
      }) : undefined);
    const skills = options.skills
      ?? (options.attachDefaultSkills ? loadDefaultJarvisSkillRuntime() : undefined);
    this.memoryAttached = Boolean(attached?.service);
    this.memorySchemaVersion = attached?.schemaVersion;
    this.memoryStore = memoryStore;
    this.capabilityHost = capabilities;
    this.capabilityIds = capabilities?.list().map(item => item.id) ?? [];
    const allowlists = loadDesktopAllowlists();
    this.applicationIds = configuredApplicationIds(allowlists);
    this.projectIds = configuredProjectIds(allowlists);
    this.llm = options.llm ?? new LocalLlmProvider();
    this.modelProfiles = options.modelProfiles ?? new ModelProfileRegistry();
    this.modelCertifications = options.modelCertifications ?? new ModelCertificationRegistry();
    this.persona = options.persona ?? (options.attachDefaultPresentation ? new FileBehaviorPersonaProvider() : undefined);
    this.speech = options.speech ?? (options.attachDefaultSpeech ? new StandaloneVoiceRouter() : undefined);
    this.voices = options.voices
      ?? (this.speech ? new RouterVoiceResolver(this.speech) : undefined)
      ?? (options.attachDefaultPresentation ? new ProbeVoiceProfileResolver() : undefined);
    this.engine = new FactPreservingPresentationEngine({
      persona: this.persona,
      voices: this.voices,
      affectStyle: () => this.commandCenter?.affect.style(),
    });
    this.stt = options.stt ?? new LocalSTTProvider();
    this.probeStt = options.probeStt ?? (async () => ({
      reachable: false,
      baseUrl: getStandaloneSttBaseUrl(),
      reason: 'STT probe disabled in this runtime.',
    }));
    this.core = options.core ?? new LocalLlmJarvisCore(this.llm, {
      memory: attached?.service,
      capabilities,
      skills,
    });
    if (options.commandCenter === false) {
      this.commandCenter = undefined;
    } else if (options.commandCenter) {
      this.commandCenter = options.commandCenter;
      if (this.capabilityHost) this.commandCenter.attachCapabilities(this.capabilityHost);
    } else if (options.attachDefaultCapabilities) {
      this.commandCenter = sharedCommandCenter();
      if (this.capabilityHost) this.commandCenter.attachCapabilities(this.capabilityHost);
    }
    if (this.commandCenter && attached?.store) {
      this.commandCenter.attachMemoryStore(attached.store);
    }
  }

  public async status(sessionId = 'jarvis-lab'): Promise<JarvisLabStatus> {
    let llm: JarvisLabStatus['llm'];
    try {
      const runtime = this.llm?.getRuntimeStatus ? await this.llm.getRuntimeStatus() : undefined;
      llm = runtime
        ? {
            ...runtime,
            ...(runtime.model ? {
              profile: configuredLocalModelProfile({
                id: runtime.model,
                displayName: runtime.model,
                runtime: runtime.provider ?? 'unknown',
              }),
            } : {}),
          }
        : undefined;
    } catch {
      llm = { enabled: false, reachable: false };
    }
    if (llm?.profile) this.modelProfiles.replace(llm.profile);
    const services = await this.serviceSnapshot();
    const selfKnowledge = await this.selfKnowledgeSnapshot({
      modelId: llm?.profile?.id,
      modelAvailable: llm?.reachable,
      services,
    });
    return {
      discordRequired: false,
      ready: true,
      coreState: this.memoryAttached || llm?.reachable ? 'ready' : 'degraded',
      memory: {
        attached: this.memoryAttached,
        schemaVersion: this.memorySchemaVersion,
      },
      capabilities: {
        attached: this.capabilityIds.length > 0,
        ids: [...this.capabilityIds],
        catalog: this.capabilityHost?.list().map(item => ({
          id: item.id,
          description: item.description,
          providerKind: item.providerKind,
          untrustedOutput: item.untrustedOutput,
          requiredService: item.requiredService,
          sideEffect: item.sideEffect,
        })) ?? [],
      },
      presentation: await this.presentationStatus(sessionId),
      llm,
      stt: await this.probeStt(),
      runtime: describeJarvisRuntimeProfile(),
      speech: {
        attached: Boolean(this.speech),
        outputDevice: 'default',
        resource: this.speech && 'resourcePolicy' in this.speech
          ? (this.speech as StandaloneVoiceRouter).resourcePolicy()
          : { phase: 'listening', unload: 'none' },
      },
      services,
      reminders: this.reminderStatus(),
      research: this.researchStatus(),
      workspace: this.workspaceStatus(),
      operations: sharedJarvisEventBus().recent(12).map(item => ({
        type: item.type,
        at: item.at,
        summary: item.summary,
        level: item.level,
      })),
      selfKnowledge,
    };
  }

  public async selfKnowledgeSnapshot(input: {
    modelId?: string;
    modelAvailable?: boolean;
    services?: Awaited<ReturnType<JarvisLabRuntime['serviceSnapshot']>>;
  } = {}): Promise<SelfKnowledgeSnapshot> {
    const providerState = new Map<string, 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN'>();
    if (input.modelId) {
      providerState.set(input.modelId, input.modelAvailable === true
        ? 'AVAILABLE'
        : input.modelAvailable === false
          ? 'UNAVAILABLE'
          : 'UNKNOWN');
    }
    return buildSelfKnowledgeSnapshot({
      host: this.capabilityHost,
      selfModel: this.commandCenter?.selfModel,
      modelProfiles: this.modelProfiles,
      modelCertifications: this.modelCertifications,
      modelProviderState: providerState,
      services: (input.services ?? await this.serviceSnapshot() ?? []).map(service => ({
        id: service.id,
        state: service.health === 'healthy'
          ? 'AVAILABLE'
          : service.health === 'degraded'
            ? 'DEGRADED'
            : service.health === 'unknown'
              ? 'UNKNOWN'
              : 'UNAVAILABLE',
        detail: service.reason,
        evidence: [`service:${service.id}:${service.health}`],
      })),
      declarations: cctvCapabilityContracts(),
    });
  }

  public recentOperations() {
    return sharedJarvisEventBus().recent(40);
  }

  public capabilities(): CapabilityHost | undefined {
    return this.capabilityHost;
  }

  public async securitySnapshot(): Promise<HostSecuritySnapshot> {
    return probeHostSecurity();
  }

  public async privateResearchSnapshot(): Promise<PrivateRouteHealth> {
    return new PrivateResearchGateway().healthCheck();
  }

  public workspaceSnapshot(): WorkspaceSnapshot {
    return this.workspace?.snapshot() ?? {
      attached: false,
      healthy: false,
      reason: 'Workspace runtime is unavailable.',
      indexStatus: 'unavailable',
    };
  }

  public refreshWorkspace(workspaceId?: string): WorkspaceSnapshot {
    if (!this.workspace) {
      return {
        attached: false,
        healthy: false,
        reason: 'Workspace runtime is unavailable.',
        indexStatus: 'unavailable',
      };
    }
    this.workspace.refreshIndex(workspaceId);
    return this.workspace.snapshot();
  }

  public researchSnapshot(): ResearchSnapshot {
    return this.research?.snapshot() ?? {
      attached: false,
      healthy: false,
      reason: 'Research runtime is unavailable.',
    };
  }

  public reminderSnapshot(): ReminderSnapshot {
    if (!this.reminders) {
      return {
        scheduler: {
          healthy: false,
          attached: false,
          timezone: 'UTC',
          nextRunAt: null,
          activeCount: 0,
          pendingCount: 0,
          reason: 'Reminder scheduler is unavailable.',
        },
        reminders: [],
        pendingDeliveries: [],
      };
    }
    return this.reminders.scheduler.snapshot();
  }

  public async ackReminder(input: {
    reminderId: string;
    occurrenceAt: string;
    action: 'dismiss' | 'complete' | 'snooze';
    minutes?: number;
  }): Promise<ReminderSnapshot> {
    if (!this.capabilityHost) throw new Error('Reminder actions are unavailable.');
    const id = input.action === 'snooze'
      ? 'reminders.snooze'
      : input.action === 'complete'
        ? 'reminders.complete'
        : 'reminders.dismiss';
    await this.capabilityHost.invoke({
      id,
      input: input.action === 'snooze'
        ? { reminderId: input.reminderId, occurrenceAt: input.occurrenceAt, minutes: input.minutes ?? 10 }
        : { reminderId: input.reminderId, occurrenceAt: input.occurrenceAt },
      source: 'ui',
    });
    return this.reminderSnapshot();
  }

  private reminderStatus(): NonNullable<JarvisLabStatus['reminders']> {
    if (!this.reminders) {
      return { attached: false, healthy: false, reason: 'Reminder store is unavailable.' };
    }
    const status = this.reminders.scheduler.status();
    return {
      attached: true,
      healthy: status.healthy,
      timezone: status.timezone,
      nextRunAt: status.nextRunAt,
      activeCount: status.activeCount,
      pendingCount: status.pendingCount,
    };
  }

  private researchStatus(): NonNullable<JarvisLabStatus['research']> {
    const snapshot = this.researchSnapshot();
    return {
      attached: snapshot.attached,
      healthy: snapshot.healthy,
      reason: snapshot.reason,
    };
  }

  private workspaceStatus(): NonNullable<JarvisLabStatus['workspace']> {
    const snapshot = this.workspaceSnapshot();
    return {
      attached: snapshot.attached,
      healthy: snapshot.healthy,
      reason: snapshot.reason,
      documentCount: snapshot.documentCount,
      indexStatus: snapshot.indexStatus,
    };
  }

  private async serviceSnapshot(): Promise<NonNullable<JarvisLabStatus['services']> | undefined> {
    if (!this.capabilityHost || !isActionHost(this.capabilityHost) || !this.capabilityHost.services) {
      return undefined;
    }
    try {
      return await this.capabilityHost.services.snapshot();
    } catch {
      return undefined;
    }
  }

  public async presentationStatus(sessionId = 'jarvis-lab'): Promise<JarvisLabPresentationStatus> {
    const session = this.sessions.get(sessionId);
    const personaId = session.activeProfile.personaProfileId;
    const voiceId = session.activeProfile.voiceProfileId;
    const persona = this.persona ? await this.persona.get(personaId) : { profileId: personaId };
    const voice = this.voices
      ? await this.voices.resolve(voiceId)
      : {
        profileId: voiceId,
        selected: true,
        available: false,
        speechActive: false,
        reason: 'Speech runtime was not probed. Voice is selected but not active for speech.',
      };
    return {
      sessionId,
      brain: { id: session.activeProfile.brainProfileId || JARVIS_BRAIN_ID, available: true },
      persona: {
        id: personaId,
        available: Boolean(persona),
        mode: session.activeProfile.personaMode,
      },
      voice: { ...voice, selected: true },
      session,
    };
  }

  public selectPersona(sessionId: string, personaProfileId: string): PresentationSessionState {
    return this.sessions.selectPersona(sessionId, personaProfileId);
  }

  public selectVoice(sessionId: string, voiceProfileId: string): PresentationSessionState {
    return this.sessions.selectVoice(sessionId, voiceProfileId);
  }

  public async transcribe(input: {
    pcm: Uint8Array;
    sampleRate?: number;
    channels?: number;
    turnId?: string;
    sessionId?: string;
    captureDurationMs?: number;
    voicedMs?: number;
    timeoutMs?: number;
  }): Promise<StandaloneTranscriptResult & { turnId: string; requestId?: string; captureDurationMs: number }> {
    const turnId = input.turnId?.trim() || `mic-${Date.now()}`;
    const pcm = toSttStereoPcm(
      input.pcm,
      input.sampleRate ?? 48_000,
      input.channels ?? 2,
    );
    const result = await transcribeStandaloneUtterance(this.stt, pcm, {
      turnId,
      sessionId: input.sessionId || 'jarvis-lab',
      timeoutMs: input.timeoutMs,
      voicedMs: input.voicedMs,
      captureDurationMs: input.captureDurationMs,
    });
    const request = result.status === 'final'
      ? createSpeechJarvisRequest({ transcript: result.text, turnId, sessionId: input.sessionId })
      : undefined;
    const captureDurationMs = input.captureDurationMs
      ?? durationMsOfPcm(pcm, STT_PCM_SAMPLE_RATE, STT_PCM_CHANNELS);
    return {
      ...result,
      turnId,
      captureDurationMs,
      ...(request ? { requestId: request.requestId } : {}),
    };
  }

  public async ask(input: JarvisLabAskInput): Promise<StandaloneTextTurnOutput & {
    coreState: 'complete';
    presentation: JarvisLabPresentationStatus;
    speech?: VoiceOutputResult;
    pendingConfirmation?: PendingConfirmation;
    research: ResearchSnapshot;
    workspace: WorkspaceSnapshot;
    intent?: { stage: string; detail: string; kind: string; capabilityId?: string };
    route?: RouteDecision;
    taskId?: string;
    workOutcome?: SynthesizedTaskResponse;
    affectStyle?: AffectStyle;
    pendingGoal?: PendingGoalRecord;
    selfKnowledge?: SelfKnowledgeAnswer;
  }> {
    const knowledgeKind = selfKnowledgeQuestionKind(String(input.text || ''));
    const sessionId = input.sessionId?.trim() || 'jarvis-lab';
    if (knowledgeKind && !this.workCenter()?.pendingGoals.store.waiting(sessionId).length) {
      return this.answerSelfKnowledgeTurn(input, this.prepareSelfKnowledgeSession(input), knowledgeKind);
    }
    const prepared = await this.prepareAsk(input);
    const memoryTurn = await this.finishOwnerMemoryTurn(input, prepared);
    if (memoryTurn) return memoryTurn;
    if (prepared.continuedTask) {
      return this.finishWorkTask(input, prepared.sessionId, {
        route: 'CAPABILITY', socialAction: 'SPEAK', agentic: true, reason: 'pending_goal_continuation', confidence: 1,
      }, prepared.continuedTask, prepared.pendingContinuation?.pendingGoal);
    }
    const { route, useWork } = this.decideAskRoute(input, prepared);
    if (useWork) {
      const worked = await this.askViaWorkAgent(input, prepared.sessionId, route, prepared.resolution);
      await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, worked);
      return worked;
    }
    const output = await runStandaloneTextTurn(prepared.turn, {
      core: this.core,
      engine: this.engine,
    });
    await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, output);
    const adjusted = this.attachUnavailableAlternatives(output, prepared.resolution, prepared.sessionId);
    const speech = await this.maybeSpeak(adjusted.presented.text, adjusted.request.requestId, adjusted.presented.voiceProfileId, input.speak);
    return {
      ...adjusted,
      coreState: 'complete',
      presentation: await this.presentationStatus(prepared.sessionId),
      research: this.researchSnapshot(),
      workspace: this.workspaceSnapshot(),
      intent: prepared.intent,
      route,
      affectStyle: this.workCenter()?.affect.style(),
      ...(prepared.pendingGoal ? { pendingGoal: prepared.pendingGoal } : {}),
      ...(speech ? { speech } : {}),
    };
  }

  public async askStream(
    input: JarvisLabAskInput,
    emit: (event: { type: 'draft' | 'final' | 'speech'; text?: string; payload?: unknown }) => void,
  ): Promise<StandaloneTextTurnOutput & {
    coreState: 'complete';
    presentation: JarvisLabPresentationStatus;
    speech?: VoiceOutputResult;
    route?: RouteDecision;
    taskId?: string;
    workOutcome?: SynthesizedTaskResponse;
    affectStyle?: AffectStyle;
    pendingGoal?: PendingGoalRecord;
    selfKnowledge?: SelfKnowledgeAnswer;
  }> {
    const knowledgeKind = selfKnowledgeQuestionKind(String(input.text || ''));
    const sessionId = input.sessionId?.trim() || 'jarvis-lab';
    if (knowledgeKind && !this.workCenter()?.pendingGoals.store.waiting(sessionId).length) {
      const output = await this.answerSelfKnowledgeTurn(input, this.prepareSelfKnowledgeSession(input), knowledgeKind);
      emit({ type: 'final', payload: output });
      if (output.speech) emit({ type: 'speech', payload: output.speech });
      return output;
    }
    const prepared = await this.prepareAsk(input);
    const memoryTurn = await this.finishOwnerMemoryTurn(input, prepared);
    if (memoryTurn) {
      emit({ type: 'final', payload: memoryTurn });
      if (memoryTurn.speech) emit({ type: 'speech', payload: memoryTurn.speech });
      return memoryTurn;
    }
    if (prepared.continuedTask) {
      const output = await this.finishWorkTask(input, prepared.sessionId, {
        route: 'CAPABILITY', socialAction: 'SPEAK', agentic: true, reason: 'pending_goal_continuation', confidence: 1,
      }, prepared.continuedTask, prepared.pendingContinuation?.pendingGoal);
      emit({ type: 'final', payload: output });
      if (output.speech) emit({ type: 'speech', payload: output.speech });
      return output;
    }
    const { route, useWork } = this.decideAskRoute(input, prepared);
    if (useWork) {
      const output = await this.askViaWorkAgent(input, prepared.sessionId, route, prepared.resolution);
      await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, output);
      emit({ type: 'final', payload: output });
      if (output.speech) emit({ type: 'speech', payload: output.speech });
      return output;
    }
    const output = await runStandaloneTextTurn(prepared.turn, {
      core: this.core,
      engine: this.engine,
      onDraft: (accumulated) => emit({ type: 'draft', text: accumulated }),
    });
    await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, output);
    const adjusted = this.attachUnavailableAlternatives(output, prepared.resolution, prepared.sessionId);
    const speech = await this.maybeSpeak(output.presented.text, output.request.requestId, output.presented.voiceProfileId, input.speak);
    const finalPayload = {
      ...adjusted,
      coreState: 'complete' as const,
      presentation: await this.presentationStatus(prepared.sessionId),
      research: this.researchSnapshot(),
      workspace: this.workspaceSnapshot(),
      intent: prepared.intent,
      route,
      affectStyle: this.workCenter()?.affect.style(),
      ...(prepared.pendingGoal ? { pendingGoal: prepared.pendingGoal } : {}),
      ...(speech ? { speech } : {}),
    };
    emit({ type: 'final', payload: finalPayload });
    if (speech) emit({ type: 'speech', payload: speech });
    return finalPayload;
  }

  public async cancelSpeech(turnId: string): Promise<void> {
    await this.speech?.cancel(turnId);
  }

  public async confirmAction(input: {
    proposalId: string;
    token: string;
    sessionId?: string;
    speak?: boolean;
    actionSource?: 'text' | 'voice' | 'ui' | 'system';
  }): Promise<StandaloneTextTurnOutput & {
    coreState: 'complete';
    presentation: JarvisLabPresentationStatus;
    speech?: VoiceOutputResult;
    pendingConfirmation?: PendingConfirmation;
  }> {
    if (!this.capabilityHost || !isActionHost(this.capabilityHost)) {
      throw new Error('Action confirmation is unavailable.');
    }
    const sessionId = input.sessionId?.trim() || 'jarvis-lab';
    const waiting = this.workCenter()?.agent.store.active().find(task => (
      task.status === 'WAITING_PERMISSION'
      && task.plan.some(step => step.pendingConfirmation?.proposalId === input.proposalId)
    ));
    if (waiting) {
      const task = await this.workCenter()!.grantAndResume(waiting.id, {
        actor: 'owner',
        proposalId: input.proposalId,
        token: input.token,
      });
      return this.finishWorkTask({ text: waiting.objective, sessionId, speak: input.speak }, sessionId, routeJarvisRequest({ text: waiting.objective }), task);
    }
    const invoked = await this.capabilityHost.confirm({
      proposalId: input.proposalId,
      token: input.token,
      source: input.actionSource ?? 'ui',
      sessionId,
    });
    return this.finishActionTurn(invoked, sessionId, input.speak);
  }

  public async denyAction(input: {
    proposalId: string;
    sessionId?: string;
    speak?: boolean;
    actionSource?: 'text' | 'voice' | 'ui' | 'system';
  }): Promise<StandaloneTextTurnOutput & {
    coreState: 'complete';
    presentation: JarvisLabPresentationStatus;
    speech?: VoiceOutputResult;
  }> {
    if (!this.capabilityHost || !isActionHost(this.capabilityHost)) {
      throw new Error('Action confirmation is unavailable.');
    }
    const sessionId = input.sessionId?.trim() || 'jarvis-lab';
    const invoked = await this.capabilityHost.denyProposal(input.proposalId, input.actionSource ?? 'ui');
    return this.finishActionTurn(invoked, sessionId, input.speak);
  }

  private decideAskRoute(
    input: JarvisLabAskInput,
    prepared: Awaited<ReturnType<JarvisLabRuntime['prepareAsk']>>,
  ): { route: RouteDecision; useWork: boolean } {
    const route = routeJarvisRequest({
      text: String(input.text || '').trim(),
      intentKind: prepared.resolution.kind,
    });
    const desktopDirect = Boolean(prepared.resolution.capabilityId?.startsWith('desktop.'));
    return {
      route,
      useWork: !desktopDirect && ((prepared.resolution.goal?.status === 'RESOLVED'
        && prepared.resolution.goal.handler === 'CAPABILITY_PLAN') || shouldUseWorkAgent(route, {
        explicitCalls: Boolean(input.capabilityCalls?.length || input.capabilities?.length),
        intentKind: prepared.resolution.kind,
        capabilityId: prepared.resolution.capabilityId,
      })),
    };
  }

  private async answerSelfKnowledgeTurn(
    input: JarvisLabAskInput,
    sessionId: string,
    kind: SelfKnowledgeAnswer['kind'],
  ) {
    const snapshot = await this.selfKnowledgeSnapshot();
    const question = String(input.text || '');
    const gap = kind === 'CCTV_STATUS'
      ? await new CapabilityGapResolver().resolve({
          objective: CCTV_CONNECT_GOAL.title,
          graph: resolveCapabilityGoal(CCTV_CONNECT_GOAL, snapshot),
          snapshot,
        })
      : kind === 'GAP_EXPLANATION'
        ? await resolveSelfKnowledgeGap(question, snapshot)
        : undefined;
    const answer = answerFromSelfKnowledge(kind, snapshot, gap, question);
    const request = createJarvisRequest({ text: String(input.text || ''), sessionId });
    const result: JarvisCoreResult = {
      requestId: request.requestId,
      answerIntent: 'self_knowledge',
      verifiedFacts: [{
        key: 'jarvis.selfKnowledge',
        value: { generatedAt: snapshot.generatedAt, capabilityIds: answer.capabilityIds, kind: answer.kind },
        sourceType: 'system',
        sourceRef: `self-knowledge:${snapshot.generatedAt}`,
        immutableForPresentation: true,
      }],
      unverifiedClaims: [],
      toolResults: [],
      memoryRefs: [],
      actionResults: [],
      uncertainty: snapshot.unknowns,
      suggestedContent: answer.text,
    };
    const presented = await this.engine.render(
      result,
      this.sessions.resolveTurn(sessionId, input.oneTurn ? turnOverride(input) : undefined),
      { sessionId },
    );
    const speech = await this.maybeSpeak(answer.text, request.requestId, presented.voiceProfileId, input.speak);
    return {
      request,
      result,
      presented: { ...presented, text: answer.text },
      timings: { totalMs: 0 },
      coreState: 'complete' as const,
      presentation: await this.presentationStatus(sessionId),
      research: this.researchSnapshot(),
      workspace: this.workspaceSnapshot(),
      intent: { stage: 'self_knowledge', detail: 'Evidence-backed capability intelligence', kind: answer.kind },
      route: { route: 'CONVERSATION' as const, socialAction: 'SPEAK' as const, agentic: false, reason: 'structured_self_knowledge', confidence: 1 },
      selfKnowledge: answer,
      affectStyle: this.commandCenter?.affect.style(),
      ...(speech ? { speech } : {}),
    };
  }

  private prepareSelfKnowledgeSession(input: JarvisLabAskInput): string {
    const sessionId = input.sessionId?.trim() || 'jarvis-lab';
    if (!input.oneTurn) {
      if (input.personaProfileId) this.sessions.selectPersona(sessionId, input.personaProfileId);
      if (input.voiceProfileId) this.sessions.selectVoice(sessionId, input.voiceProfileId);
    }
    return sessionId;
  }

  private workCenter(): CommandCenterRuntime | undefined {
    if (this.commandCenter) return this.commandCenter;
    if (!this.capabilityHost) return undefined;
    this.commandCenter = new CommandCenterRuntime({
      host: this.capabilityHost,
      simulated: false,
    });
    return this.commandCenter;
  }

  private async askViaWorkAgent(
    input: JarvisLabAskInput,
    sessionId: string,
    route: RouteDecision,
    resolution?: IntentResolution,
  ): Promise<StandaloneTextTurnOutput & {
    coreState: 'complete';
    presentation: JarvisLabPresentationStatus;
    speech?: VoiceOutputResult;
    pendingConfirmation?: PendingConfirmation;
    research: ResearchSnapshot;
    workspace: WorkspaceSnapshot;
    intent?: { stage: string; detail: string; kind: string; capabilityId?: string };
    route?: RouteDecision;
    taskId?: string;
    workOutcome?: SynthesizedTaskResponse;
    affectStyle?: AffectStyle;
  }> {
    const center = this.workCenter();
    if (!center) {
      throw new Error('Work agent is unavailable for this request.');
    }
    const task = await center.runObjective(String(input.text || '').trim(), {
      sessionId,
      goalResolution: resolution?.goal,
    });
    return this.finishWorkTask(input, sessionId, route, task);
  }

  private async finishWorkTask(
    input: JarvisLabAskInput,
    sessionId: string,
    route: RouteDecision,
    task: Awaited<ReturnType<CommandCenterRuntime['runObjective']>>,
    pendingGoal?: PendingGoalRecord,
  ) {
    const synthesis = synthesizeTaskResponse(task);
    const request = createJarvisRequest({ text: task.objective, sessionId });
    const waiting = task.plan.find(step => step.status === 'waiting_permission');
    const result: JarvisCoreResult = {
      requestId: request.requestId,
      answerIntent: 'standalone_action',
      verifiedFacts: [],
      unverifiedClaims: [],
      toolResults: task.toolResults.map(item => ({
        toolName: item.capability,
        status: item.status === 'ok' ? 'ok' as const : 'error' as const,
        summary: item.summary,
      })),
      memoryRefs: [],
      actionResults: freezeActionResults([{
        name: 'work_agent',
        capabilityId: waiting?.capability || task.toolResults[0]?.capability || 'work.agent',
        status: task.status === 'COMPLETED'
          ? 'completed'
          : task.status === 'WAITING_PERMISSION'
            ? 'confirmation_required'
            : task.status === 'CANCELLED'
              ? 'denied'
              : 'failed',
        summary: synthesis.text,
      }]),
      uncertainty: [],
      suggestedContent: synthesis.text,
    };
    const presentation = this.sessions.resolveTurn(sessionId);
    const presented = await this.engine.render(result, presentation, { sessionId });
    const speech = await this.maybeSpeak(synthesis.text, request.requestId, presented.voiceProfileId, input.speak);
    return {
      request,
      result,
      presented: { ...presented, text: synthesis.text },
      timings: { totalMs: 0 },
      coreState: 'complete' as const,
      presentation: await this.presentationStatus(sessionId),
      research: this.researchSnapshot(),
      workspace: this.workspaceSnapshot(),
      intent: {
        stage: route.agentic ? 'work_agent' : 'conversation',
        detail: route.reason,
        kind: route.route,
        capabilityId: waiting?.capability,
      },
      route,
      taskId: task.id,
      workOutcome: synthesis,
      affectStyle: this.workCenter()?.affect.style(),
      ...(speech ? { speech } : {}),
      ...(waiting?.pendingConfirmation ? {
        pendingConfirmation: {
          proposalId: waiting.pendingConfirmation.proposalId,
          token: waiting.permissionLease?.token
            || (waiting.pendingConfirmation.proposalId
              ? this.workCenter()?.agent.peekConfirmationToken(waiting.pendingConfirmation.proposalId)
              : undefined)
            || '',
          capabilityId: waiting.pendingConfirmation.capability,
          displayName: waiting.pendingConfirmation.capability,
          summary: waiting.pendingConfirmation.summary || synthesis.text,
          target: waiting.capability || '',
          risk: 'CONFIRM_REQUIRED' as const,
          reason: waiting.pendingConfirmation.summary || 'Owner permission required.',
          expiresAt: waiting.pendingConfirmation.expiresAt || '',
          preflight: waiting.pendingConfirmation.preflight || waiting.preflight,
        },
      } : {}),
      ...(pendingGoal ? { pendingGoal } : {}),
    };
  }

  private async maybeSpeak(
    text: string,
    turnId: string,
    voiceProfileId: string,
    speak?: boolean,
  ): Promise<VoiceOutputResult | undefined> {
    if (!this.speech) return undefined;
    const shaped = shapeSpokenText(text);
    if (!shaped) return undefined;
    const speechClass = classifySpeechEvent({
      greeting: /^(hello|hi\b|hey\b|สวัสดี|I'm here)/iu.test(shaped),
      actionCompleted: /is open|opened|moved|เปิด .+ ให้แล้ว/iu.test(shaped),
      error: /can't|cannot|failed|ไม่สำเร็จ/iu.test(shaped),
      blocked: /allowlist|CLICK|TYPE|SUBMIT|blocked/iu.test(shaped),
      clarification: /\?$/.test(shaped),
      conversation: true,
    });
    const decision = decideSpeech({
      speechClass,
      mode: this.speechMode,
      speakRequested: speak,
      duplicateOfLast: isDuplicateUtterance(this.lastSpoken, shaped),
    });
    if (!decision.speak) return undefined;
    this.lastSpoken = shaped;
    return await this.speech.speak(shaped, this.speech.resolveProfile(voiceProfileId), {
      turnId,
      text: shaped,
    });
  }

  private async prepareAsk(input: JarvisLabAskInput): Promise<{
    sessionId: string;
    turn: Parameters<typeof runStandaloneTextTurn>[0];
    resolution: IntentResolution;
    intent: { stage: string; detail: string; kind: string; capabilityId?: string };
    continuedTask?: WorkTask;
    pendingContinuation?: PendingGoalContinuation;
    pendingGoal?: PendingGoalRecord;
  }> {
    const text = String(input.text || '').trim()
      || (input.capabilityCalls?.[0]?.id ?? '');
    if (!text) throw new Error('Enter text for Jarvis.');
    const sessionId = input.sessionId?.trim() || 'jarvis-lab';
    const override = turnOverride(input);
    if (!input.oneTurn && (input.personaProfileId || input.voiceProfileId)) {
      if (input.personaProfileId) this.sessions.selectPersona(sessionId, input.personaProfileId);
      if (input.voiceProfileId) this.sessions.selectVoice(sessionId, input.voiceProfileId);
    }
    const presentation = this.sessions.resolveTurn(sessionId, input.oneTurn ? override : undefined);
    const explicitCapabilities = Array.isArray(input.capabilities)
      ? input.capabilities.filter(id => typeof id === 'string')
      : [];
    const center = this.workCenter();
    const shouldAttemptContinuation = Boolean(input.continuation?.pendingGoalId)
      || Boolean(center?.pendingGoals.store.waiting(sessionId).length);
    if (center && shouldAttemptContinuation && !input.capabilityCalls?.length && explicitCapabilities.length === 0) {
      const continued = await center.continuePendingGoal({
        sessionId,
        ownerReply: text,
        pendingGoalId: input.continuation?.pendingGoalId,
        idempotencyKey: input.continuation?.idempotencyKey,
        explicitSelection: input.continuation?.explicitSelection,
      });
      if (continued.continuation.status !== 'NO_PENDING_GOAL') {
        if (continued.task && ['READY_TO_RESUME', 'ALREADY_RESUMING', 'ALREADY_RESOLVED'].includes(continued.continuation.status)) {
          return {
            sessionId,
            continuedTask: continued.task,
            pendingContinuation: continued.continuation,
            resolution: continued.continuation.resolution
              ? intentResolutionFromContinuedGoal(continued.continuation.resolution, continued.continuation.pendingGoal)
              : pendingIntentResolution(continued.continuation),
            intent: { stage: 'work_agent', detail: continued.continuation.reason, kind: 'CAPABILITY' },
            turn: {
              text,
              sessionId,
              presentation,
              capabilities: [],
              actionOnly: true,
            },
          };
        }
        const resolution = pendingIntentResolution(continued.continuation);
        return {
          sessionId,
          pendingContinuation: continued.continuation,
          resolution,
          intent: { stage: 'clarification', detail: continued.continuation.reason, kind: resolution.kind },
          turn: {
            text,
            sessionId,
            presentation,
            capabilities: [],
            actionOnly: true,
            presetActionResults: [resolution.kind === 'UNSUPPORTED'
              ? unsupportedActionResult(resolution)
              : clarificationActionResult(resolution)],
          },
        };
      }
    }
    const prepared = await resolveLabActionTurn(text, {
      catalogIds: this.capabilityIds,
      applicationIds: this.applicationIds,
      projectIds: this.projectIds,
      explicitCapabilities,
      capabilityCalls: input.capabilityCalls,
      catalog: compactCapabilityCatalog(this.capabilityHost),
      context: mergeResearchIntoContext(this.intents.get(sessionId), this.research?.snapshot().last, sessionId),
      aliases: listOwnerAliases(this.memoryStore),
      semanticResolve: this.llm?.generateText
        ? async (request) => runSemanticResolver(
          input => this.llm!.generateText!(input),
          request.text,
          request.catalog,
          request.context,
        )
        : undefined,
      capabilityHost: this.capabilityHost,
    });
    let pendingGoal: PendingGoalRecord | undefined;
    if (center && prepared.resolution.goal?.status === 'NEEDS_INPUT') {
      const current = center.pendingGoals.store.waiting(sessionId).find(item => (
        item.goalId === prepared.resolution.goal?.goalId && item.originalOwnerIntent === text
      ));
      const pending = current ?? center.beginPendingGoal({
        objective: text,
        sessionId,
        resolution: prepared.resolution.goal,
      }).pendingGoal;
      prepared.resolution.pendingGoalId = pending.pendingGoalId;
      prepared.resolution.pendingGoalExpiresAt = pending.expiresAt;
      pendingGoal = pending;
    }
    const stage = intentStageOf(prepared.resolution);
    this.rememberIntentReferents(sessionId, prepared.resolution);
    return {
      sessionId,
      resolution: prepared.resolution,
      intent: {
        stage: stage.stage,
        detail: stage.detail,
        kind: prepared.resolution.kind,
        capabilityId: prepared.resolution.capabilityId,
      },
      ...(pendingGoal ? { pendingGoal } : {}),
      turn: {
        text,
        sessionId,
        presentation,
        capabilities: prepared.capabilities,
        capabilityCalls: prepared.capabilityCalls,
        actionOnly: prepared.actionOnly,
        presetActionResults: prepared.presetActionResults,
        actionSource: input.actionSource,
      },
    };
  }

  private rememberIntentReferents(sessionId: string, resolution: IntentResolution): void {
    const args = resolution.arguments ?? {};
    if (!(resolution.capabilityId?.startsWith('desktop.open') || resolution.capabilityId === 'desktop.placeWindow')) return;
    this.intents.touch(sessionId, applyOpenedResource(this.intents.get(sessionId), {
      kind: typeof args.url === 'string' ? 'url' : 'application',
      applicationId: typeof args.applicationId === 'string' ? args.applicationId : undefined,
      url: typeof args.url === 'string' ? args.url : undefined,
      label: String(args.label || args.applicationId || args.url || resolution.capabilityId || ''),
      display: args.display && typeof args.display === 'object' ? args.display as InteractionContext['lastDisplay'] : undefined,
      openState: resolution.capabilityId === 'desktop.placeWindow'
        ? this.intents.get(sessionId)?.lastOpenedResource?.openState ?? 'intended'
        : 'intended',
    }));
  }

  private async rememberAfterTurn(
    sessionId: string,
    resolution: IntentResolution,
    output: StandaloneTextTurnOutput,
  ): Promise<void> {
    const args = resolution.arguments ?? {};
    const research = this.research?.snapshot();
    const existing = this.intents.get(sessionId);
    const nextSources = sourcesFromResearch(research?.last?.sources);
    const workspace = this.workspace?.snapshot();
    const reminderIds = this.reminders?.scheduler.snapshot().reminders.map(item => item.id).slice(0, 8);
    if (resolution.clarification) {
      this.intents.setClarification(sessionId, resolution.clarification);
    } else {
      this.intents.clearClarification(sessionId);
    }
    const opened = output.result.actionResults.some(item => (
      String(item.capabilityId || item.name || '').startsWith('desktop.open')
      && item.status === 'completed'
    ));
    const placed = output.result.actionResults.some(item => (
      String(item.capabilityId || item.name || '') === 'desktop.placeWindow'
      && item.status === 'completed'
    ));
    const tracked = await this.inspectOpenedWindow(sessionId, args);
    this.intents.touch(sessionId, {
      activeIntent: resolution.kind,
      lastCapabilityId: resolution.capabilityId ?? this.intents.get(sessionId)?.lastCapabilityId,
      lastServiceId: typeof args.serviceId === 'string' ? args.serviceId : this.intents.get(sessionId)?.lastServiceId,
      lastApplicationId: typeof args.applicationId === 'string' ? args.applicationId : this.intents.get(sessionId)?.lastApplicationId,
      ...(resolution.capabilityId?.startsWith('desktop.open') || resolution.capabilityId === 'desktop.placeWindow'
        ? applyOpenedResource(this.intents.get(sessionId), {
          kind: typeof args.url === 'string' ? 'url' : 'application',
          applicationId: typeof args.applicationId === 'string' ? args.applicationId : undefined,
          url: typeof args.url === 'string' ? args.url : undefined,
          label: String(args.label || args.applicationId || args.url || resolution.capabilityId || ''),
          display: args.display && typeof args.display === 'object' ? args.display as InteractionContext['lastDisplay'] : undefined,
          openState: opened || placed
            ? 'opened'
            : (output.pendingConfirmation ? 'intended' : this.intents.get(sessionId)?.lastOpenedResource?.openState ?? 'intended'),
          processName: tracked.processName,
          windowHandle: tracked.windowHandle,
          currentDisplayId: tracked.displayId,
          placementScope: typeof args.url === 'string' ? 'process-window' : 'unknown',
        })
        : {}),
      recentResearchQuery: typeof args.query === 'string' && String(resolution.capabilityId || '').startsWith('research.')
        ? String(args.query)
        : research?.last?.query || existing?.recentResearchQuery,
      recentResearchSessionId: research?.last?.sessionId || existing?.recentResearchSessionId,
      lastResearchSources: nextSources.length ? nextSources : existing?.lastResearchSources,
      currentResearch: research?.last?.query || existing?.currentResearch,
      currentSource: existing?.currentSource || (nextSources.length === 1 ? nextSources[0]!.url : undefined),
      currentWebsite: typeof args.url === 'string' ? String(args.url) : this.intents.get(sessionId)?.currentWebsite,
      currentApplication: typeof args.applicationId === 'string' ? String(args.applicationId) : this.intents.get(sessionId)?.currentApplication,
      currentDisplay: args.display && typeof args.display === 'object'
        ? args.display as InteractionContext['currentDisplay']
        : this.intents.get(sessionId)?.currentDisplay,
      recentWorkspaceId: workspace?.workspaceId ?? this.intents.get(sessionId)?.recentWorkspaceId,
      currentWorkspace: this.intents.get(sessionId)?.currentWorkspace ?? workspace?.workspaceId,
      recentDocumentQuery: typeof args.query === 'string' && String(resolution.capabilityId || '').startsWith('workspace.')
        ? String(args.query)
        : workspace?.last?.query ?? this.intents.get(sessionId)?.recentDocumentQuery,
      recentDocumentIds: workspace?.last?.documentRefs?.slice(0, 8) ?? this.intents.get(sessionId)?.recentDocumentIds,
      recentDocumentEvidenceIds: workspace?.last?.evidence.map(item => item.evidenceId).slice(0, 8)
        ?? this.intents.get(sessionId)?.recentDocumentEvidenceIds,
      recentReminderIds: resolution.capabilityId?.startsWith('reminders.') ? reminderIds : this.intents.get(sessionId)?.recentReminderIds,
      pendingProposalId: output.pendingConfirmation?.proposalId,
    });
  }

  private attachUnavailableAlternatives(
    output: StandaloneTextTurnOutput,
    resolution: IntentResolution,
    sessionId: string,
  ): StandaloneTextTurnOutput {
    const action = output.result.actionResults[0];
    if (!resolution.alternatives?.length || !isUnavailableAction(action)) return output;
    const offer = resolution.alternatives.map(item => item.label).join(' หรือ ');
    const extra = `ตอนนี้เป้าหมายยังไม่พร้อม ต้องการ${offer}ไหม?`;
    const now = Date.now();
    this.intents.setClarification(sessionId, {
      clarificationId: newClarificationId(now),
      originalRequestId: output.request.requestId,
      question: extra,
      candidateIntents: resolution.alternatives,
      expiresAt: now + 10 * 60_000,
    });
    return {
      ...output,
      presented: { ...output.presented, text: `${output.presented.text}\n${extra}`.trim() },
      result: {
        ...output.result,
        suggestedContent: `${output.result.suggestedContent || ''}\n${extra}`.trim(),
      },
    };
  }

  private async resolveTaughtDisplayTarget(
    target: string,
    sessionId: string,
  ): Promise<{ ok: true; value: string } | { ok: false; message: string }> {
    if (target.startsWith('display.fp:') || target === 'display.internal') return { ok: true, value: target };
    if (target === 'display.current') {
      return { ok: false, message: 'I cannot prove which screen is showing Jarvis right now. Tell me the monitor number instead.' };
    }
    const ordinal = target.match(/^ordinal:(\d+)$/u);
    if (ordinal) {
      const displays = await enumerateWindowsDisplays().catch(() => []);
      const display = displays[Number(ordinal[1]) - 1];
      if (!display) {
        return { ok: false, message: `I only see ${displays.length} display${displays.length === 1 ? '' : 's'}. There is no monitor ${ordinal[1]}.` };
      }
      return { ok: true, value: serializeDisplayFingerprint(fingerprintDisplay(display, Number(ordinal[1]))) };
    }
    void sessionId;
    return { ok: true, value: target };
  }

  private async inspectOpenedWindow(
    sessionId: string,
    args: Record<string, unknown>,
  ): Promise<{ processName?: string; windowHandle?: string; displayId?: string }> {
    const existing = this.intents.get(sessionId)?.lastOpenedResource;
    const processName = typeof args.url === 'string'
      ? processNameForUrl(String(args.url))
      : typeof args.applicationId === 'string'
        ? processNameForApplication(String(args.applicationId))
        : existing?.processName;
    if (!processName) return { processName: existing?.processName, windowHandle: existing?.windowHandle };
    const candidates = typeof args.url === 'string'
      ? processNamesForUrl(String(args.url))
      : [processName];
    let window = null as Awaited<ReturnType<typeof inspectAllowlistedWindow>>;
    let matched = processName;
    for (const name of candidates) {
      window = await inspectAllowlistedWindow({
        processName: name,
        windowHandle: typeof args.windowHandle === 'string' ? args.windowHandle : existing?.windowHandle,
      });
      if (window) {
        matched = name;
        break;
      }
    }
    if (!window) return { processName: matched, windowHandle: existing?.windowHandle };
    const displays = await enumerateWindowsDisplays().catch(() => []);
    return {
      processName: matched,
      windowHandle: window.handle,
      displayId: classifyWindowOnDisplays(window, displays).displayId,
    };
  }

  private async inspectPlacementContainment(sessionId: string): Promise<string> {
    const incidents = [
      ...sharedTrustedOperatorRuntime().containment.listActive('desktop.placeWindow'),
      ...sharedTrustedOperatorRuntime().containment.listActive('desktop.openScopedResource'),
    ];
    if (!incidents.length) return 'No placement or scoped-open containment is active.';
    const incident = incidents[0]!;
    const context = this.intents.get(sessionId);
    const processName = context?.lastOpenedResource?.processName
      || (incident.affectedTargets.some(target => /^https?:/u.test(target)) ? 'msedge' : undefined);
    const displays = await enumerateWindowsDisplays().catch(() => []);
    const candidates = context?.lastOpenedResource?.url
      ? processNamesForUrl(context.lastOpenedResource.url)
      : processName
        ? [processName]
        : [];
    let window = null as Awaited<ReturnType<typeof inspectAllowlistedWindow>>;
    for (const name of candidates) {
      window = await inspectAllowlistedWindow({
        processName: name,
        windowHandle: context?.lastOpenedResource?.windowHandle,
      });
      if (window) break;
    }
    const classified = classifyWindowOnDisplays(window, displays);
    const reconciled = reconcileContainment(incident, evidenceFromWindowInspection({
      windowFound: classified.windowFound,
      straddling: classified.straddling,
      fullyOnOneDisplay: classified.fullyOnOneDisplay,
      currentDisplayId: classified.displayId,
    }));
    this.intents.touch(sessionId, { pendingContainmentId: reconciled.canProposeClear ? incident.id : undefined });
    const where = !classified.windowFound
      ? ' I do not see that window open now.'
      : classified.displayId
        ? ` The trusted browser window is currently on ${classified.displayId}${classified.straddling ? ' and appears to span more than one display' : ''}.`
        : '';
    return `${reconciled.message}${where} This is only containment ${incident.id}.`;
  }

  private clearPlacementContainment(sessionId: string, text: string): string {
    const containment = sharedTrustedOperatorRuntime().containment;
    const pending = this.intents.get(sessionId)?.pendingContainmentId;
    if (!pending) {
      return 'I can inspect the current placement containment first. Say “Check it” if you want me to review only that scope.';
    }
    if (!/\byes\b|clear|ล้าง|ได้/iu.test(text)) {
      return 'Say yes if you want me to clear only that placement containment.';
    }
    const cleared = containment.clear(pending, 'owner');
    this.intents.touch(sessionId, { pendingContainmentId: undefined });
    if (!cleared) return 'I could not clear that containment. Owner recovery is still required.';
    return 'Cleared only that placement containment. Other containment is unchanged.';
  }

  private async finishOwnerMemoryTurn(
    input: JarvisLabAskInput,
    prepared: Awaited<ReturnType<JarvisLabRuntime['prepareAsk']>>,
  ) {
    const reason = prepared.resolution.reasonCode;
    if (
      reason !== 'TEACH_ALIAS'
      && reason !== 'FORGET_ALIAS'
      && reason !== 'ASK_MEMORY'
      && reason !== 'REMEMBER_PREFERENCE'
      && reason !== 'LIST_DISPLAYS'
      && reason !== 'INSPECT_CONTAINMENT'
      && reason !== 'CLEAR_CONTAINMENT'
      && reason !== 'RESEARCH_OFFICIAL_SOURCE'
    ) {
      return undefined;
    }
    const args = prepared.resolution.arguments || {};
    const phrase = String(args.aliasPhrase || args.entity || input.text);
    const language = preferredLanguage(input.text, this.intents.get(prepared.sessionId)?.conversationLanguage);
    this.intents.touch(prepared.sessionId, { conversationLanguage: language });
    let text = 'I can remember that if you say it as an owner preference.';
    if (reason === 'LIST_DISPLAYS') {
      const displays = await enumerateWindowsDisplays().catch(() => []);
      text = describeDisplays(displays);
    } else if (reason === 'INSPECT_CONTAINMENT') {
      text = await this.inspectPlacementContainment(prepared.sessionId);
    } else if (reason === 'RESEARCH_OFFICIAL_SOURCE') {
      text = prepared.resolution.userMessage || 'I do not have a current research source to open.';
      if (typeof args.url === 'string') {
        this.intents.touch(prepared.sessionId, { currentSource: String(args.url) });
      }
    } else if (reason === 'CLEAR_CONTAINMENT') {
      text = this.clearPlacementContainment(prepared.sessionId, input.text);
    } else if (reason === 'TEACH_ALIAS') {
      const target = await this.resolveTaughtDisplayTarget(String(args.target || 'display.internal'), prepared.sessionId);
      if (target.ok === false) {
        text = target.message;
      } else {
        const written = rememberOwnerAlias(this.memoryStore, {
          phrase,
          target: target.value,
          kind: 'display',
          actor: 'owner',
          evidence: 'OWNER_STATED',
        });
        text = written.ok
          ? speakInLanguage(language, {
            en: `I’ll remember “${phrase}” as that physical monitor. If it disappears I will say so instead of guessing.`,
            th: `จำว่า “${phrase}” คือจอเครื่องนั้นแล้วครับ ถ้าจอหายไปผมจะบอก ไม่เดาจอใหม่ให้`,
          })
          : written.ok === false ? written.message : 'I could not store that alias.';
      }
    } else if (reason === 'FORGET_ALIAS') {
      const forgotten = forgetOwnerAlias(this.memoryStore, phrase, 'owner');
      text = forgotten.ok ? `I’ve forgotten the “${phrase}” alias.` : forgotten.ok === false ? forgotten.message : 'I could not forget that alias.';
    } else if (reason === 'ASK_MEMORY') {
      text = formatAliasAnswer(listOwnerAliases(this.memoryStore, /monitor|screen|จอ/iu.test(input.text) ? 'display' : undefined));
    } else if (reason === 'REMEMBER_PREFERENCE') {
      const pref = String(args.target || '');
      if (pref.startsWith('workspace.current=')) {
        const named = pref.slice('workspace.current='.length);
        const resolved = resolveRegisteredWorkspace(named, {
          workspaces: loadWorkspaceRegistry().list().map(item => ({ id: item.id, displayName: item.displayName, root: item.root })),
          projects: loadDesktopAllowlists().projects.map(item => ({ id: item.id, displayName: item.displayName, path: item.path, installed: item.installed })),
        });
        if (resolved.ok === false) {
          text = resolved.message;
        } else {
          this.intents.touch(prepared.sessionId, {
            currentWorkspace: resolved.workspaceId,
            recentWorkspaceId: resolved.workspaceId,
          });
          rememberOwnerAlias(this.memoryStore, {
            phrase: named,
            target: resolved.workspaceId,
            kind: 'project',
            actor: 'owner',
            evidence: 'OWNER_STATED',
          });
          text = speakInLanguage(language, {
            en: `I’ll treat “${resolved.label}” as the current registered project. I will not store a raw filesystem path from that sentence.`,
            th: `จำว่าโปรเจกต์ปัจจุบันคือ “${resolved.label}” จาก registry แล้วครับ จะไม่เก็บ path จากข้อความ`,
          });
        }
      } else {
        const written = rememberOwnerPreference(this.memoryStore, {
          key: String(args.target || 'preference'),
          value: String(args.target || input.text),
          actor: 'owner',
        });
        text = written.ok ? 'I’ll keep that as an owner preference.' : written.ok === false ? written.message : 'I could not store that preference.';
      }
    }
    const request = createJarvisRequest({ text: input.text, sessionId: prepared.sessionId, actionSource: input.actionSource });
    const result = {
      requestId: request.requestId,
      answerIntent: 'owner_memory',
      verifiedFacts: [{
        key: 'owner.memory',
        value: text,
        sourceType: 'memory' as const,
        confidence: 1,
        immutableForPresentation: true,
      }],
      unverifiedClaims: [],
      toolResults: [],
      memoryRefs: listOwnerAliases(this.memoryStore).slice(0, 6).map(item => ({
        canonicalId: item.factKey,
        domain: 'global' as const,
        type: 'alias',
        confidence: 0.95,
      })),
      actionResults: [],
      uncertainty: [],
      suggestedContent: text,
    };
    const presented = await this.engine.render(
      result,
      this.sessions.resolveTurn(prepared.sessionId, input.oneTurn ? turnOverride(input) : undefined),
      { sessionId: prepared.sessionId },
    );
    const speech = await this.maybeSpeak(text, request.requestId, presented.voiceProfileId, input.speak);
    return {
      request,
      result,
      presented: { ...presented, text },
      timings: { totalMs: 0 },
      coreState: 'complete' as const,
      presentation: await this.presentationStatus(prepared.sessionId),
      research: this.researchSnapshot(),
      workspace: this.workspaceSnapshot(),
      intent: prepared.intent,
      ...(speech ? { speech } : {}),
    };
  }

  private async finishActionTurn(
    invoked: Awaited<ReturnType<NonNullable<CapabilityHost['invoke']>>>,
    sessionId: string,
    speak?: boolean,
  ): Promise<StandaloneTextTurnOutput & {
    coreState: 'complete';
    presentation: JarvisLabPresentationStatus;
    speech?: VoiceOutputResult;
    pendingConfirmation?: PendingConfirmation;
  }> {
    const action = capabilityResultToActionResult(invoked);
    const pending = isActionHost(this.capabilityHost!) ? this.capabilityHost.pendingFrom(invoked) : undefined;
    const request = createJarvisRequest({
      text: action.summary || action.name,
      sessionId,
      actionOnly: true,
      actionSource: 'ui',
    });
    const research = isResearchResult(invoked.structured?.research) ? invoked.structured.research : undefined;
    const workspace = isWorkspaceResult(invoked.structured?.workspace) ? invoked.structured.workspace : undefined;
    const result: JarvisCoreResult = {
      requestId: request.requestId,
      answerIntent: 'standalone_action',
      verifiedFacts: [
        ...(research ? researchFactsFromResult(research) : []),
        ...(workspace ? workspaceFactsFromResult(workspace) : []),
      ],
      unverifiedClaims: [],
      toolResults: [capabilityResultToToolRef(invoked)],
      memoryRefs: [],
      documentRefs: workspace?.documentRefs,
      sourceRefs: research?.sourceRefs,
      actionResults: freezeActionResults([action]),
      uncertainty: [],
      suggestedContent: action.summary || invoked.content,
    };
    const presentation = this.sessions.resolveTurn(sessionId);
    const presented = await this.engine.render(result, presentation, { sessionId });
    const speech = await this.maybeSpeak(presented.text, request.requestId, presented.voiceProfileId, speak);
    if (invoked.status === 'ok' && invoked.capabilityId.startsWith('desktop.open')) {
      const current = this.intents.get(sessionId)?.lastOpenedResource;
      if (current) {
        this.intents.touch(sessionId, {
          lastOpenedResource: { ...current, openState: 'opened' },
        });
      }
    }
    return {
      request,
      result,
      presented,
      timings: { totalMs: 0 },
      coreState: 'complete',
      presentation: await this.presentationStatus(sessionId),
      ...(speech ? { speech } : {}),
      ...(pending ? { pendingConfirmation: pending } : {}),
    };
  }
}

export function createJarvisLabRuntime(options: JarvisLabRuntimeOptions = {}): JarvisLabRuntime {
  return new JarvisLabRuntime(options);
}

function turnOverride(input: JarvisLabAskInput): PresentationOverride | undefined {
  const override: PresentationOverride = {};
  if (input.personaProfileId) {
    override.personaProfileId = input.personaProfileId;
    override.personaMode = input.personaProfileId === JARVIS_PERSONA_ID ? 'NONE' : 'STYLE';
  }
  if (input.voiceProfileId) override.voiceProfileId = input.voiceProfileId;
  return Object.keys(override).length ? override : undefined;
}

function pendingIntentResolution(continuation: PendingGoalContinuation): IntentResolution {
  const unsupported = continuation.status === 'BLOCKED' || continuation.status === 'EXPIRED';
  return {
    kind: unsupported ? 'UNSUPPORTED' : 'CLARIFICATION',
    confidence: 'HIGH',
    reasonCode: `PENDING_GOAL_${continuation.status}`,
    userMessage: continuation.question || continuation.reason,
    consumed: true,
    source: 'context',
    actionClass: unsupported ? 'INFORMATION' : 'AMBIGUOUS',
    goal: continuation.resolution,
    pendingGoalId: continuation.pendingGoal?.pendingGoalId,
    pendingGoalExpiresAt: continuation.pendingGoal?.expiresAt,
  };
}

function intentResolutionFromContinuedGoal(goal: NonNullable<PendingGoalContinuation['resolution']>, pending?: PendingGoalRecord): IntentResolution {
  const selected = goal.routes.find(route => route.id === goal.selectedRouteId);
  const first = selected?.steps[0];
  return {
    kind: first ? 'CAPABILITY' : 'UNSUPPORTED',
    capabilityId: first?.capabilityId,
    arguments: first?.input,
    confidence: 'HIGH',
    reasonCode: 'PENDING_GOAL_RESUMED',
    consumed: true,
    source: 'context',
    actionClass: selected?.risk === 'READ_ONLY' ? 'INFORMATION' : 'ACTIONABLE',
    goal,
    pendingGoalId: pending?.pendingGoalId,
    pendingGoalExpiresAt: pending?.expiresAt,
  };
}

async function resolveLabActionTurn(text: string, input: {
  catalogIds: string[];
  applicationIds: string[];
  projectIds: string[];
  explicitCapabilities: string[];
  capabilityCalls?: JarvisLabAskInput['capabilityCalls'];
  catalog: ReturnType<typeof compactCapabilityCatalog>;
  context?: ReturnType<InteractionContextStore['get']>;
  aliases?: import('../memory/ownerSemantics').OwnerAliasRecord[];
  semanticResolve?: Parameters<typeof resolveUserIntent>[1] extends infer T
    ? T extends { semanticResolve?: infer S } ? S : undefined
    : undefined;
  capabilityHost?: CapabilityHost;
}): Promise<{
  capabilities: string[];
  capabilityCalls?: JarvisLabAskInput['capabilityCalls'];
  actionOnly?: boolean;
  presetActionResults?: ActionResult[];
  resolution: IntentResolution;
}> {
  if (input.capabilityCalls && input.capabilityCalls.length > 0) {
    return {
      capabilities: input.capabilityCalls.map(call => call.id),
      capabilityCalls: input.capabilityCalls,
      actionOnly: input.capabilityCalls.every(call => !input.catalogIds.includes(call.id) || isActionFastPathId(call.id)),
      resolution: {
        kind: 'CAPABILITY',
        capabilityId: input.capabilityCalls[0]?.id,
        arguments: input.capabilityCalls[0]?.input,
        confidence: 'HIGH',
        reasonCode: 'EXPLICIT_CALL',
        consumed: true,
        source: 'fast-path',
        actionClass: 'ACTIONABLE',
      },
    };
  }
  if (input.catalogIds.includes(text)) {
    return {
      capabilities: [text],
      resolution: {
        kind: 'CAPABILITY',
        capabilityId: text,
        confidence: 'HIGH',
        reasonCode: 'EXPLICIT_ID',
        consumed: true,
        source: 'fast-path',
        actionClass: 'ACTIONABLE',
      },
    };
  }
  if (input.explicitCapabilities.length > 0) {
    return {
      capabilities: input.explicitCapabilities,
      resolution: {
        kind: 'CAPABILITY',
        capabilityId: input.explicitCapabilities[0],
        confidence: 'HIGH',
        reasonCode: 'EXPLICIT_CAPABILITY',
        consumed: true,
        source: 'fast-path',
        actionClass: 'ACTIONABLE',
      },
    };
  }
  const resolution = await resolveUserIntent(text, {
    applicationIds: input.applicationIds,
    projectIds: input.projectIds,
    catalog: input.catalog,
    context: input.context,
    aliases: input.aliases,
    semanticResolve: input.semanticResolve,
    capabilityHost: input.capabilityHost,
  });
  if (resolution.kind === 'FORBIDDEN') {
    try {
      new ActionAuditLog(defaultActionAuditPath()).record({
        v: 1,
        at: new Date().toISOString(),
        proposalId: 'intent-blocked',
        capabilityId: 'system.unsupported',
        risk: 'BLOCKED',
        decision: 'deny',
        result: 'denied',
        source: 'text',
        reasonCode: resolution.reasonCode,
      });
    } catch {
      // Fail closed at execution time; blocked intents never launch.
    }
    return {
      capabilities: [],
      actionOnly: true,
      presetActionResults: [blockedActionResult(resolution.reasonCode, resolution.userMessage || 'ทำรายการนี้ไม่ได้ครับ')],
      resolution,
    };
  }
  if (resolution.kind === 'CLARIFICATION') {
    return {
      capabilities: [],
      actionOnly: true,
      presetActionResults: [clarificationActionResult(resolution)],
      resolution,
    };
  }
  if (resolution.kind === 'UNSUPPORTED') {
    return {
      capabilities: [],
      actionOnly: true,
      presetActionResults: [unsupportedActionResult(resolution)],
      resolution,
    };
  }
  if (resolution.kind === 'CAPABILITY' && resolution.capabilityId) {
    return {
      capabilities: [resolution.capabilityId],
      capabilityCalls: [
        { id: resolution.capabilityId, input: resolution.arguments ?? {} },
        ...(resolution.extraCalls ?? []),
      ],
      actionOnly: resolution.consumed !== false,
      resolution,
    };
  }
  return { capabilities: [], resolution };
}

function tryDefaultMemory(): { service: JarvisMemoryService; store: SqliteJarvisMemoryStore; schemaVersion?: number } | undefined {
  try {
    const store = SqliteJarvisMemoryStore.open();
    return { service: new JarvisMemoryRetrieval(store), store, schemaVersion: store.schemaVersion() };
  } catch (error) {
    console.warn(`[JarvisLab] Memory store not attached: ${error instanceof Error ? error.message : error}`);
    return undefined;
  }
}

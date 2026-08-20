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
import { loadDefaultJarvisSkillRuntime } from '../skills';
import type { JarvisSkillHost } from '../skills';
import { JARVIS_BRAIN_ID, JARVIS_PERSONA_ID } from '../presentation/types';
import type {
  PersonaProvider,
  PresentationOverride,
  PresentationSessionState,
  VoiceProfileAvailability,
  VoiceProfileResolver,
} from '../presentation/types';
import { FileBehaviorPersonaProvider } from '../presentation/filePersonaProvider';
import { FactPreservingPresentationEngine } from '../presentation/PresentationEngine';
import {
  runPresentationPipeline,
  spokenTextFor,
  type PlannedPresentation,
} from '../presentation/briefing';
import { sharedJarvisPresenceStore, type ClientWindowReport } from '../desktop';
import { StandalonePresentationSessions } from '../presentation/standaloneSession';
import { ProbeVoiceProfileResolver } from '../presentation/voiceAvailability';
import { RouterVoiceResolver, StandaloneVoiceRouter } from '../speech';
import type { VoiceOutputResult, VoiceOutputRouter } from '../speech';
import { LocalLlmJarvisCore, type StandaloneLlm } from './LocalLlmJarvisCore';
import { describeJarvisRuntimeProfile, type JarvisRuntimeProfile } from './runtimeProfile';
import { runStandaloneTextTurn, type StandaloneTextTurnOutput } from './textHarness';
import { CommandCenterRuntime, sharedCommandCenter } from './commandCenter';
import { routeJarvisRequest, shouldUseWorkAgent, type RouteDecision } from '../intent/requestRouter';
import { traceCapabilitiesFromTurn } from '../ops/traceCapabilities';
import { synthesizeTaskResponse } from '../agent/synthesize';
import type { SynthesizedTaskResponse } from '../agent/types';
import type { AffectStyle } from '../evolution/affect';

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
      providerKind: CapabilityProviderKind;
      untrustedOutput: boolean;
      requiredService: string;
    }>;
  };
  presentation: JarvisLabPresentationStatus;
  llm?: {
    enabled?: boolean;
    reachable?: boolean;
    model?: string;
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
  presence?: {
    hostKind: 'browser' | 'electron' | 'native-helper' | 'test';
    windowAvailable: boolean;
    canMoveWindow: boolean;
    reportedAt?: string;
    bounds?: { x: number; y: number; width: number; height: number };
  };
};

export type JarvisLabRuntimeOptions = {
  core?: JarvisCore;
  memory?: JarvisMemoryService;
  memorySchemaVersion?: number;
  capabilities?: CapabilityHost;
  skills?: JarvisSkillHost;
  persona?: PersonaProvider;
  voices?: VoiceProfileResolver;
  llm?: StandaloneLlm & { getRuntimeStatus?: () => Promise<{ enabled?: boolean; reachable?: boolean; model?: string }> };
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
};

export class JarvisLabRuntime {
  private readonly core: JarvisCore;
  private readonly llm?: JarvisLabRuntimeOptions['llm'];
  private readonly memoryAttached: boolean;
  private readonly memorySchemaVersion?: number;
  private readonly capabilityIds: string[];
  private readonly capabilityHost?: CapabilityHost;
  private readonly sessions = new StandalonePresentationSessions();
  private readonly persona?: PersonaProvider;
  private readonly voices?: VoiceProfileResolver;
  private readonly engine: FactPreservingPresentationEngine;
  private readonly stt: SpeechToTextProvider;
  private readonly probeStt: () => Promise<SttRuntimeProbe>;
  private readonly speech?: VoiceOutputRouter;
  private readonly applicationIds: string[];
  private readonly projectIds: string[];
  private readonly reminders?: ReminderRuntime;
  private readonly research?: ResearchRuntime;
  private readonly workspace?: WorkspaceRuntime;
  private readonly intents = new InteractionContextStore();
  private commandCenter?: CommandCenterRuntime;

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
    const capabilities = options.capabilities
      ?? (options.attachDefaultCapabilities ? createStandaloneCapabilityHost({
        reminders: this.reminders,
        research: this.research ? { runtime: this.research } : undefined,
        workspace: this.workspace ? { runtime: this.workspace } : undefined,
      }) : undefined);
    const skills = options.skills
      ?? (options.attachDefaultSkills ? loadDefaultJarvisSkillRuntime() : undefined);
    this.memoryAttached = Boolean(attached?.service);
    this.memorySchemaVersion = attached?.schemaVersion;
    this.capabilityHost = capabilities;
    this.capabilityIds = capabilities?.list().map(item => item.id) ?? [];
    const allowlists = loadDesktopAllowlists();
    this.applicationIds = configuredApplicationIds(allowlists);
    this.projectIds = configuredProjectIds(allowlists);
    this.llm = options.llm ?? new LocalLlmProvider();
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
      llm = this.llm?.getRuntimeStatus ? await this.llm.getRuntimeStatus() : undefined;
    } catch {
      llm = { enabled: false, reachable: false };
    }
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
          providerKind: item.providerKind,
          untrustedOutput: item.untrustedOutput,
          requiredService: item.requiredService,
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
      services: await this.serviceSnapshot(),
      reminders: this.reminderStatus(),
      research: this.researchStatus(),
      workspace: this.workspaceStatus(),
      operations: sharedJarvisEventBus().recent(12).map(item => ({
        type: item.type,
        at: item.at,
        summary: item.summary,
        level: item.level,
      })),
      presence: this.presenceStatus(),
    };
  }

  public reportPresence(report: ClientWindowReport): ReturnType<JarvisLabRuntime['presenceStatus']> {
    sharedJarvisPresenceStore().reportClientWindow(report);
    return this.presenceStatus();
  }

  public presenceStatus(): NonNullable<JarvisLabStatus['presence']> {
    const report = sharedJarvisPresenceStore().currentReport();
    const electron = typeof process.versions.electron === 'string';
    return {
      hostKind: electron ? 'electron' : 'browser',
      windowAvailable: Boolean(report),
      canMoveWindow: false,
      ...(report?.reportedAt ? { reportedAt: report.reportedAt } : {}),
      ...(report ? {
        bounds: {
          x: report.screenX,
          y: report.screenY,
          width: report.outerWidth,
          height: report.outerHeight,
        },
      } : {}),
    };
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
    briefing?: PlannedPresentation;
  }> {
    const prepared = await this.prepareAsk(input);
    const { route, useWork } = this.decideAskRoute(input, prepared);
    if (useWork) {
      return this.askViaWorkAgent(input, prepared.sessionId, route);
    }
    const output = await runStandaloneTextTurn(prepared.turn, {
      core: this.core,
      engine: this.engine,
    });
    this.rememberAfterTurn(prepared.sessionId, prepared.resolution, output);
    const adjusted = this.attachUnavailableAlternatives(output, prepared.resolution, prepared.sessionId);
    const briefing = this.buildBriefing({
      text: input.text,
      replyText: adjusted.presented.text,
      route,
      capabilityId: prepared.resolution.capabilityId,
    });
    const speech = await this.maybeSpeak(adjusted.presented.text, adjusted.request.requestId, adjusted.presented.voiceProfileId, input.speak, briefing);
    this.observeAskTurn(input, prepared.sessionId, route, adjusted);
    return {
      ...adjusted,
      coreState: 'complete',
      presentation: await this.presentationStatus(prepared.sessionId),
      research: this.researchSnapshot(),
      workspace: this.workspaceSnapshot(),
      intent: prepared.intent,
      route,
      affectStyle: this.workCenter()?.affect.style(),
      briefing,
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
    briefing?: PlannedPresentation;
  }> {
    const prepared = await this.prepareAsk(input);
    const { route, useWork } = this.decideAskRoute(input, prepared);
    if (useWork) {
      const output = await this.askViaWorkAgent(input, prepared.sessionId, route);
      emit({ type: 'final', payload: output });
      if (output.speech) emit({ type: 'speech', payload: output.speech });
      return output;
    }
    const output = await runStandaloneTextTurn(prepared.turn, {
      core: this.core,
      engine: this.engine,
      onDraft: (accumulated) => emit({ type: 'draft', text: accumulated }),
    });
    this.rememberAfterTurn(prepared.sessionId, prepared.resolution, output);
    const adjusted = this.attachUnavailableAlternatives(output, prepared.resolution, prepared.sessionId);
    this.observeAskTurn(input, prepared.sessionId, route, adjusted);
    const briefing = this.buildBriefing({
      text: input.text,
      replyText: adjusted.presented.text,
      route,
      capabilityId: prepared.resolution.capabilityId,
    });
    const finalPayload = {
      ...adjusted,
      coreState: 'complete' as const,
      presentation: await this.presentationStatus(prepared.sessionId),
      research: this.researchSnapshot(),
      workspace: this.workspaceSnapshot(),
      intent: prepared.intent,
      route,
      affectStyle: this.workCenter()?.affect.style(),
      briefing,
    };
    emit({ type: 'final', payload: finalPayload });
    const speech = await this.maybeSpeak(output.presented.text, output.request.requestId, output.presented.voiceProfileId, input.speak, briefing);
    if (speech) emit({ type: 'speech', payload: speech });
    return { ...finalPayload, ...(speech ? { speech } : {}) };
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
      return this.finishWorkTask(
        { text: waiting.objective, sessionId, speak: input.speak },
        sessionId,
        routeJarvisRequest({ text: waiting.objective }),
        task,
      );
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
    return {
      route,
      useWork: shouldUseWorkAgent(route, {
        explicitCalls: Boolean(input.capabilityCalls?.length || input.capabilities?.length),
        intentKind: prepared.resolution.kind,
        capabilityId: prepared.resolution.capabilityId,
      }),
    };
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
    const request = createJarvisRequest({
      text: String(input.text || '').trim(),
      sessionId,
    });
    const task = await center.runObjective(String(input.text || '').trim(), {
      sessionId,
      requestId: request.requestId,
      turnId: request.requestId,
      route,
    });
    return this.finishWorkTask(input, sessionId, route, task, request);
  }

  private async finishWorkTask(
    input: JarvisLabAskInput,
    sessionId: string,
    route: RouteDecision,
    task: Awaited<ReturnType<CommandCenterRuntime['runObjective']>>,
    request = createJarvisRequest({
      text: task.objective,
      sessionId,
      requestId: task.requestId,
    }),
  ) {
    const synthesis = synthesizeTaskResponse(task);
    this.workCenter()?.noteLatestRequest({
      route,
      objective: task.objective,
      taskId: task.id,
      requestId: request.requestId,
    });
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
    const briefing = this.buildBriefing({
      text: input.text || task.objective,
      replyText: synthesis.text,
      route,
      capabilityId: waiting?.capability || task.toolResults[0]?.capability,
      workOutcome: synthesis,
    });
    const speech = await this.maybeSpeak(synthesis.text, request.requestId, presented.voiceProfileId, input.speak, briefing);
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
      briefing,
      ...(speech ? { speech } : {}),
      ...(waiting?.pendingConfirmation ? {
        pendingConfirmation: {
          proposalId: waiting.pendingConfirmation.proposalId,
          token: waiting.permissionLease?.token || '',
          capabilityId: waiting.pendingConfirmation.capability,
          displayName: waiting.pendingConfirmation.capability,
          summary: waiting.pendingConfirmation.summary || synthesis.text,
          target: waiting.capability || '',
          risk: 'CONFIRM_REQUIRED' as const,
          reason: waiting.pendingConfirmation.summary || 'Owner permission required.',
          expiresAt: waiting.pendingConfirmation.expiresAt || '',
        },
      } : {}),
    };
  }

  private async maybeSpeak(
    text: string,
    turnId: string,
    voiceProfileId: string,
    speak?: boolean,
    briefing?: PlannedPresentation,
  ): Promise<VoiceOutputResult | undefined> {
    if (!speak || !this.speech) return undefined;
    const spoken = briefing ? spokenTextFor(briefing, text) : text;
    return await this.speech.speak(spoken, this.speech.resolveProfile(voiceProfileId), {
      turnId,
      text: spoken,
    });
  }

  private buildBriefing(input: {
    text: string;
    replyText: string;
    route?: RouteDecision;
    capabilityId?: string;
    workOutcome?: SynthesizedTaskResponse;
  }): PlannedPresentation {
    const research = this.researchSnapshot();
    const presence = this.presenceStatus();
    return runPresentationPipeline({
      text: input.text,
      replyText: input.replyText,
      route: input.route?.route,
      capabilityId: input.capabilityId,
      workOutcome: input.workOutcome,
      research: research.last ? {
        query: research.last.query,
        synthesis: research.last.synthesis,
        sources: research.last.sources.map(item => ({
          sourceId: item.sourceId,
          title: item.title,
          url: item.url,
          domain: item.domain,
        })),
        evidence: research.last.evidence.map(item => ({
          evidenceId: item.evidenceId,
          claim: item.claim,
          sourceId: item.sourceId,
        })),
        uncertainty: research.last.uncertainty,
        disagreements: research.last.disagreements,
      } : undefined,
      displays: input.capabilityId?.startsWith('desktop.') ? {
        hostKind: presence.hostKind,
        reason: presence.canMoveWindow ? undefined : 'Browser host cannot move the Jarvis window.',
      } : undefined,
    });
  }

  private async prepareAsk(input: JarvisLabAskInput): Promise<{
    sessionId: string;
    turn: Parameters<typeof runStandaloneTextTurn>[0];
    resolution: IntentResolution;
    intent: { stage: string; detail: string; kind: string; capabilityId?: string };
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
    const prepared = await resolveLabActionTurn(text, {
      catalogIds: this.capabilityIds,
      applicationIds: this.applicationIds,
      projectIds: this.projectIds,
      explicitCapabilities,
      capabilityCalls: input.capabilityCalls,
      catalog: compactCapabilityCatalog(this.capabilityHost),
      context: this.intents.get(sessionId),
      semanticResolve: this.llm?.generateText
        ? async (request) => runSemanticResolver(
          input => this.llm!.generateText!(input),
          request.text,
          request.catalog,
          request.context,
        )
        : undefined,
    });
    const stage = intentStageOf(prepared.resolution);
    return {
      sessionId,
      resolution: prepared.resolution,
      intent: {
        stage: stage.stage,
        detail: stage.detail,
        kind: prepared.resolution.kind,
        capabilityId: prepared.resolution.capabilityId,
      },
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

  private observeAskTurn(
    input: JarvisLabAskInput,
    sessionId: string,
    route: RouteDecision,
    output: StandaloneTextTurnOutput,
  ): void {
    const center = this.commandCenter;
    if (!center) return;
    const spec = center.runtimeSpecs.current();
    center.recordTurnTrace({
      requestId: output.request.requestId,
      sessionId,
      turnId: output.request.requestId,
      route: route.route,
      inputText: String(input.text || ''),
      totalLatencyMs: output.timings.totalMs,
      tokens: output.llm?.outputTokens,
      tokensPerSec: output.llm?.tokensPerSec,
      memoryRefs: output.result.memoryRefs?.map(item => item.canonicalId),
      capabilities: traceCapabilitiesFromTurn({
        actionResults: output.result.actionResults,
        toolResults: output.result.toolResults,
      }),
      modelProfileId: spec.layers.intelligence.modelProfileId,
      engine: spec.layers.engine.interactiveProfile,
      success: !(output.result.actionResults ?? []).some(item => item.status === 'failed' || item.status === 'denied'),
    });
    center.noteLatestRequest({
      route,
      objective: String(input.text || ''),
      requestId: output.request.requestId,
    });
  }

  private rememberAfterTurn(
    sessionId: string,
    resolution: IntentResolution,
    output: StandaloneTextTurnOutput,
  ): void {
    const args = resolution.arguments ?? {};
    const research = this.research?.snapshot();
    const workspace = this.workspace?.snapshot();
    const reminderIds = this.reminders?.scheduler.snapshot().reminders.map(item => item.id).slice(0, 8);
    if (resolution.clarification) {
      this.intents.setClarification(sessionId, resolution.clarification);
    } else {
      this.intents.clearClarification(sessionId);
    }
    this.intents.touch(sessionId, {
      activeIntent: resolution.kind,
      lastCapabilityId: resolution.capabilityId ?? this.intents.get(sessionId)?.lastCapabilityId,
      lastServiceId: typeof args.serviceId === 'string' ? args.serviceId : this.intents.get(sessionId)?.lastServiceId,
      lastApplicationId: typeof args.applicationId === 'string' ? args.applicationId : undefined,
      recentResearchQuery: typeof args.query === 'string' && String(resolution.capabilityId || '').startsWith('research.')
        ? String(args.query)
        : research?.last?.query,
      recentResearchSessionId: research?.last?.sessionId,
      recentWorkspaceId: workspace?.workspaceId ?? this.intents.get(sessionId)?.recentWorkspaceId,
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

async function resolveLabActionTurn(text: string, input: {
  catalogIds: string[];
  applicationIds: string[];
  projectIds: string[];
  explicitCapabilities: string[];
  capabilityCalls?: JarvisLabAskInput['capabilityCalls'];
  catalog: ReturnType<typeof compactCapabilityCatalog>;
  context?: ReturnType<InteractionContextStore['get']>;
  semanticResolve?: Parameters<typeof resolveUserIntent>[1] extends infer T
    ? T extends { semanticResolve?: infer S } ? S : undefined
    : undefined;
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
    semanticResolve: input.semanticResolve,
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
      capabilityCalls: [{ id: resolution.capabilityId, input: resolution.arguments ?? {} }],
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

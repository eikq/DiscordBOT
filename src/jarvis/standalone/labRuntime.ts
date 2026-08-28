import { LocalLlmProvider } from '../../bot/llm/LocalLlmProvider';
import { CANONICAL_LLM_BASE_URL, CANONICAL_LLM_MODEL } from '../../bot/llm/canonicalRuntime';
import { MODEL_HEALTH_STATUSES, ownerMessageForModelHealth, type ModelHealthStatus } from '../../bot/llm/modelHealth';
import { QWEN_OFFLINE_OWNER_MESSAGE } from '../models/qwen38Cyber';
import {
  COMMUNITY_MODEL_OFFLINE_MESSAGE,
  communityCapabilitySummaryText,
  communityUnavailablePrivateText,
  createEditionCapabilityHost,
  isCommunityCapabilityAllowed,
  isCommunityEdition,
  jarvisDataRoot,
  jarvisEditionManifest,
  jarvisWorkspaceLogicalPath,
  resolveJarvisEdition,
} from '../edition';
import { spokenTrustedModelIdentity, trustedRuntimeModelIdentity } from '../models/runtimeIdentity';
import { SqliteJarvisMemoryStore } from '../../bot/memory/jarvis/SqliteJarvisMemoryStore';
import type { ConversationHistoryStore } from '../../bot/memory/jarvis/conversationStore';
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
import { ownerConfirmationVisibleText, ownerDecisionSourceFrom } from '../security/ownerConfirmation';
import { redactSecrets } from '../security/redaction';
import { emptyPermissionRuntimeSnapshot, type PermissionRuntimeSnapshot } from '../security/permissionSnapshot';
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
  conversationActionResult,
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
import type { CapabilityHost, CapabilityProviderKind } from '../capabilities/types';
import { createJarvisRequest } from '../core/request';
import type { ActionResult, JarvisCore, JarvisCoreResult } from '../core/types';
import { JarvisMemoryRetrieval } from '../memory/retrieval';
import { memoryRefsFromItems, type JarvisMemoryService } from '../memory/service';
import {
  forgetOwnerAlias,
  formatAliasAnswer,
  formatOwnerPreferenceAnswer,
  listOwnerAliases,
  rememberOwnerAlias,
  rememberOwnerPreference,
} from '../memory/ownerSemantics';
import { extractDurableOwnerMemory } from '../memory/durableExtract';
import { buildJarvisContext, CONTEXT_RECENT_TURN_LIMIT } from '../memory/contextBuilder';
import { projectObsidianVault } from '../memory/obsidianProjection';
import { BuildPlanStore } from '../build/planStore';
import { isPlanApprovalUtterance } from '../build/planner';
import { SOFTWARE_APPLY_BUILD } from '../build/constants';
import { permissionProposalFromBuild } from '../security/permissionProposal';
import { applyOpenedResource, observedDisplaySelector } from '../memory/workingContext';
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
import type { AgentRuntime } from '../runtime/types';
import { AgentRuntimeMemoryBridge, AgentRuntimeOwnerTaskCoordinator, type AgentRuntimeMcpBoundary } from '../runtime';
import { runStandaloneTextTurn, type StandaloneTextTurnOutput } from './textHarness';
import { CommandCenterRuntime, sharedCommandCenter } from './commandCenter';
import { routeJarvisRequest, shouldUseWorkAgent, type RouteDecision } from '../intent/requestRouter';
import { synthesizeTaskResponse } from '../agent/synthesize';
import type { SynthesizedTaskResponse } from '../agent/types';
import type { AffectStyle } from '../evolution/affect';
import type { PendingGoalContinuation, PendingGoalRecord } from '../goals';
import type { WorkTask } from '../agent/types';
import {
  applyTurnToConversation,
  ConversationStateStore,
  conversationDebugView,
  conversationView,
  defaultConversationStatePath,
  interpretDiscourse,
  restoreProject,
  discoursePreemptsPendingGoal,
  isOperationalNoise,
  slugFromWorkspacePath,
  compactResearchSpeak,
  compactOwnerSpeak,
  type ConversationState,
  type DiscourseInterpretation,
} from '../conversation';

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
  edition: 'owner' | 'community';
  editionLabel: string;
  dataRoot: string;
  manifest: ReturnType<typeof jarvisEditionManifest>;
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
    health?: string;
    ownerMessage?: string;
    modelAvailable?: boolean;
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
  llm?: StandaloneLlm & { getRuntimeStatus?: () => Promise<{ enabled?: boolean; reachable?: boolean; model?: string; provider?: 'ollama' | 'openai-compatible'; health?: string; ownerMessage?: string; modelAvailable?: boolean }> };
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
  agentRuntime?: AgentRuntime;
  agentRuntimeMcpBoundary?: AgentRuntimeMcpBoundary;
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
  private readonly agentRuntime?: AgentRuntime;
  private readonly agentRuntimeConversation?: AgentRuntimeOwnerTaskCoordinator;
  private readonly plans?: BuildPlanStore;
  private readonly conversations: ConversationStateStore;
  private activeJarvisTurnId?: string;
  private lastConversationBind?: {
    sessionId: string;
    text: string;
    resolution: IntentResolution;
    discourse: DiscourseInterpretation;
  };
  private readonly llmGeneratesAnswers: boolean;

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
    const sqlite = memoryStore instanceof SqliteJarvisMemoryStore ? memoryStore : undefined;
    this.plans = sqlite ? new BuildPlanStore(sqlite.database()) : undefined;
    this.conversations = new ConversationStateStore(
      options.attachDefaultCapabilities ? defaultConversationStatePath() : undefined,
    );
    const capabilities = options.capabilities
      ?? (options.attachDefaultCapabilities ? createEditionCapabilityHost({
        reminders: this.reminders,
        research: this.research ? { runtime: this.research } : undefined,
        workspace: this.workspace ? { runtime: this.workspace } : undefined,
        actions: {
          displayAliases: () => listOwnerAliases(memoryStore, 'display'),
        },
        ...(sqlite ? { build: { db: sqlite.database() } } : {}),
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
    this.llm = options.llm ?? new LocalLlmProvider(
      process.env.JARVIS_LLM_BASE_URL || process.env.LOCAL_QWEN_BASE_URL || CANONICAL_LLM_BASE_URL,
      process.env.JARVIS_LLM_MODEL
        || process.env.LOCAL_QWEN_MODEL
        || (isCommunityEdition() ? 'local-model' : CANONICAL_LLM_MODEL),
    );
    this.modelProfiles = options.modelProfiles ?? new ModelProfileRegistry();
    this.modelCertifications = options.modelCertifications ?? new ModelCertificationRegistry();
    this.agentRuntime = options.agentRuntime;
    this.agentRuntimeConversation = this.agentRuntime ? new AgentRuntimeOwnerTaskCoordinator({
      runtime: this.agentRuntime,
      ...(attached?.service ? { memory: new AgentRuntimeMemoryBridge(attached.service) } : {}),
      ...(options.agentRuntimeMcpBoundary ? { mcp: options.agentRuntimeMcpBoundary } : {}),
    }) : undefined;
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
      buildContext: request => this.dynamicContext(request.clientContext.sessionId, request.input.text),
    });
    this.llmGeneratesAnswers = !options.core;
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
      llm = { enabled: false, reachable: false, health: 'MODEL_OFFLINE', ownerMessage: this.offlineModelMessage() };
    }
    if (llm?.profile) this.modelProfiles.replace(llm.profile);
    if (isCommunityEdition() && llm && llm.health !== 'MODEL_READY') {
      llm.ownerMessage = COMMUNITY_MODEL_OFFLINE_MESSAGE;
    }
    const modelReady = llm?.health === 'MODEL_READY';
    const services = await this.serviceSnapshot();
    const selfKnowledge = await this.selfKnowledgeSnapshot({
      modelId: llm?.profile?.id,
      modelAvailable: modelReady,
      services,
    });
    const edition = resolveJarvisEdition();
    const manifest = jarvisEditionManifest(edition);
    return {
      discordRequired: false,
      edition,
      editionLabel: manifest.label,
      dataRoot: jarvisDataRoot(),
      manifest,
      ready: true,
      coreState: this.memoryAttached || modelReady ? 'ready' : 'degraded',
      memory: {
        attached: this.memoryAttached,
        schemaVersion: this.memorySchemaVersion,
      },
      capabilities: {
        attached: this.capabilityIds.length > 0,
        ids: this.capabilityIds.filter(id => edition !== 'community' || isCommunityCapabilityAllowed(id)),
        catalog: (this.capabilityHost?.list() ?? []).filter(item => edition !== 'community' || isCommunityCapabilityAllowed(item.id)).map(item => ({
          id: item.id,
          description: item.description,
          providerKind: item.providerKind,
          untrustedOutput: item.untrustedOutput,
          requiredService: item.requiredService,
          sideEffect: item.sideEffect,
        })),
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
      agentRuntime: isCommunityEdition() ? undefined : this.agentRuntime,
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
      declarations: isCommunityEdition() ? [] : cctvCapabilityContracts(),
    });
  }

  public recentOperations() {
    return sharedJarvisEventBus().recent(40);
  }

  public permissionSnapshot(sessionId = 'jarvis-lab'): PermissionRuntimeSnapshot {
    this.hydrateConversation(sessionId);
    const view = isActionHost(this.capabilityHost)
      ? this.capabilityHost.runtimePermissionView?.()
      : undefined;
    const pending = view?.pending
      || (!view && isActionHost(this.capabilityHost)
        ? this.capabilityHost.hydratePendingConfirmation?.(sessionId)
        : undefined);
    const conversationState = this.conversations.get(sessionId);
    const plan = (conversationState.activePlanId && this.plans?.get(conversationState.activePlanId))
      || this.plans?.latestForSession(sessionId)
      || null;
    const lease = view?.lease
      ?? sharedTrustedOperatorRuntime().leases.listInventory().find(item => item.state === 'ACTIVE')
      ?? null;
    const preview = sharedTrustedOperatorRuntime().devServers?.list().find(item => (
      item.status === 'running' || item.status === 'starting' || item.status === 'unknown'
    )) || null;
    const stage = pending
      ? 'PERMISSION'
      : plan
        ? ({
            DRAFT: 'PLAN',
            READY_FOR_REVIEW: 'REVIEW',
            APPROVED: 'PERMISSION',
            WAITING_PERMISSION: 'PERMISSION',
            EXECUTING: 'SCAFFOLD',
            VERIFYING: 'VERIFY',
            COMPLETED: 'DONE',
            FAILED: 'BUILD',
          } as const)[plan.status] || 'PLAN'
        : null;
    const conversation = {
      ...conversationView(conversationState),
      debug: conversationDebugView(conversationState, {
        intent: this.lastConversationBind?.sessionId === sessionId
          ? this.lastConversationBind.discourse.act
          : conversationState.lastDiscourse,
        capabilityId: this.lastConversationBind?.sessionId === sessionId
          ? this.lastConversationBind.resolution.capabilityId
          : conversationState.lastJarvisAction,
        permissionOutcome: pending ? 'WAITING' : lease ? 'LEASE_ACTIVE' : 'NONE',
      }),
    };
    if (!pending && !plan && !lease && !preview && !conversation.project && !conversation.goal) {
      return { ...emptyPermissionRuntimeSnapshot(), conversation };
    }
    return {
      pendingPermission: pending || null,
      permissionRecord: view?.record || null,
      lease,
      plan: plan ? {
        id: plan.id,
        goalId: plan.goalId,
        title: plan.title,
        slug: plan.slug,
        status: plan.status,
        summary: plan.summary,
        updatedAt: plan.updatedAt,
      } : null,
      stage,
      preview,
      conversation,
    };
  }

  public capabilities(): CapabilityHost | undefined {
    return this.capabilityHost;
  }

  public async securitySnapshot(): Promise<HostSecuritySnapshot> {
    return probeHostSecurity();
  }

  public async privateResearchSnapshot(): Promise<PrivateRouteHealth> {
    if (isCommunityEdition()) {
      return {
        virtualBox: 'unknown',
        gateway: 'unknown',
        workstation: 'unknown',
        tor: 'unknown',
        isolationOk: false,
        available: false,
        reasonCode: 'COMMUNITY_EXCLUDED',
        detail: 'Private browser is not part of Jarvis Community Edition.',
      };
    }
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
    this.persistOwnerTurn(sessionId, String(input.text || ''), input.actionSource === 'voice' ? 'voice' : 'text');
    extractDurableOwnerMemory(this.memoryStore, String(input.text || ''));
    const approved = await this.continueApprovedPlan(input, sessionId);
    if (approved) return this.finalizeVisibleTurn(sessionId, approved);
    if (knowledgeKind && !this.workCenter()?.pendingGoals.store.waiting(sessionId).length) {
      return this.finalizeVisibleTurn(sessionId, await this.answerSelfKnowledgeTurn(input, this.prepareSelfKnowledgeSession(input), knowledgeKind));
    }
    const prepared = await this.prepareAsk(input);
    const granted = await this.grantPendingFromText(input, prepared);
    if (granted) return this.finalizeVisibleTurn(sessionId, granted);
    const memoryTurn = await this.finishOwnerMemoryTurn(input, prepared);
    if (memoryTurn) return this.finalizeVisibleTurn(sessionId, memoryTurn);
    if (prepared.continuedTask) {
      return this.finalizeVisibleTurn(sessionId, await this.finishWorkTask(input, prepared.sessionId, {
        route: 'CAPABILITY', socialAction: 'SPEAK', agentic: true, reason: 'pending_goal_continuation', confidence: 1,
      }, prepared.continuedTask, prepared.pendingContinuation?.pendingGoal));
    }
    const { route, useWork } = this.decideAskRoute(input, prepared);
    if (useWork) {
      const worked = await this.askViaWorkAgent(input, prepared.sessionId, route, prepared.resolution);
      await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, worked);
      return this.finalizeVisibleTurn(sessionId, worked);
    }
    if (!this.hasDeterministicAskReply(prepared)) {
      const runtimeReply = await this.maybeAgentRuntimeReply(input, prepared, route);
      if (runtimeReply) {
        await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, runtimeReply);
        return this.finalizeVisibleTurn(sessionId, runtimeReply);
      }
      const offline = await this.maybeOfflineModelReply(input, sessionId);
      if (offline) return this.finalizeVisibleTurn(sessionId, offline);
    }
    const output = await runStandaloneTextTurn(prepared.turn, {
      core: this.core,
      engine: this.engine,
    });
    await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, output);
    const adjusted = this.attachUnavailableAlternatives(output, prepared.resolution, prepared.sessionId);
    const speech = await this.maybeSpeak(adjusted.presented.text, adjusted.request.requestId, adjusted.presented.voiceProfileId, input.speak);
    return this.finalizeVisibleTurn(sessionId, {
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
    });
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
    this.persistOwnerTurn(sessionId, String(input.text || ''), input.actionSource === 'voice' ? 'voice' : 'text');
    extractDurableOwnerMemory(this.memoryStore, String(input.text || ''));
    const emitFinal = async <T extends { presented?: { text: string }; speech?: VoiceOutputResult }>(output: T): Promise<T> => {
      const finalized = this.finalizeVisibleTurn(sessionId, output as T & { presented: { text: string } });
      emit({ type: 'final', payload: finalized });
      if (finalized.speech) emit({ type: 'speech', payload: finalized.speech });
      return finalized;
    };
    const approved = await this.continueApprovedPlan(input, sessionId);
    if (approved) return emitFinal(approved);
    if (knowledgeKind && !this.workCenter()?.pendingGoals.store.waiting(sessionId).length) {
      return emitFinal(await this.answerSelfKnowledgeTurn(input, this.prepareSelfKnowledgeSession(input), knowledgeKind));
    }
    const prepared = await this.prepareAsk(input);
    const granted = await this.grantPendingFromText(input, prepared);
    if (granted) return emitFinal(granted);
    const memoryTurn = await this.finishOwnerMemoryTurn(input, prepared);
    if (memoryTurn) return emitFinal(memoryTurn);
    if (prepared.continuedTask) {
      return emitFinal(await this.finishWorkTask(input, prepared.sessionId, {
        route: 'CAPABILITY', socialAction: 'SPEAK', agentic: true, reason: 'pending_goal_continuation', confidence: 1,
      }, prepared.continuedTask, prepared.pendingContinuation?.pendingGoal));
    }
    const { route, useWork } = this.decideAskRoute(input, prepared);
    if (useWork) {
      const output = await this.askViaWorkAgent(input, prepared.sessionId, route, prepared.resolution);
      await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, output);
      return emitFinal(output);
    }
    if (!this.hasDeterministicAskReply(prepared)) {
      const runtimeReply = await this.maybeAgentRuntimeReply(input, prepared, route);
      if (runtimeReply) {
        await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, runtimeReply);
        return emitFinal(runtimeReply);
      }
      const offline = await this.maybeOfflineModelReply(input, sessionId);
      if (offline) return emitFinal(offline);
    }
    const output = await runStandaloneTextTurn(prepared.turn, {
      core: this.core,
      engine: this.engine,
      onDraft: (accumulated) => emit({ type: 'draft', text: accumulated }),
    });
    await this.rememberAfterTurn(prepared.sessionId, prepared.resolution, output);
    const adjusted = this.attachUnavailableAlternatives(output, prepared.resolution, prepared.sessionId);
    const speech = await this.maybeSpeak(output.presented.text, output.request.requestId, output.presented.voiceProfileId, input.speak);
    return emitFinal({
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
    });
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
    duration?: 'ONCE' | 'THIS_GOAL';
    visibleText?: string;
    alreadyPersisted?: boolean;
  }): Promise<StandaloneTextTurnOutput & {
    coreState: 'complete';
    presentation: JarvisLabPresentationStatus;
    speech?: VoiceOutputResult;
    pendingConfirmation?: PendingConfirmation;
    research: ResearchSnapshot;
    workspace: WorkspaceSnapshot;
  }> {
    if (!this.capabilityHost || !isActionHost(this.capabilityHost)) {
      throw new Error('Action confirmation is unavailable.');
    }
    const sessionId = input.sessionId?.trim() || 'jarvis-lab';
    const source = ownerDecisionSourceFrom(input.actionSource);
    if (!input.alreadyPersisted) {
      this.persistOwnerTurn(
        sessionId,
        ownerConfirmationVisibleText({
          decision: 'allow',
          duration: input.duration,
          visibleText: input.visibleText,
          source,
        }),
        source === 'voice' ? 'voice' : source === 'text' ? 'text' : 'ui_action',
      );
    }
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
      duration: input.duration,
    });
    return this.finalizeVisibleTurn(sessionId, await this.finishActionTurn(invoked, sessionId, input.speak));
  }

  public async denyAction(input: {
    proposalId: string;
    sessionId?: string;
    speak?: boolean;
    actionSource?: 'text' | 'voice' | 'ui' | 'system';
    visibleText?: string;
  }): Promise<StandaloneTextTurnOutput & {
    coreState: 'complete';
    presentation: JarvisLabPresentationStatus;
    speech?: VoiceOutputResult;
  }> {
    if (!this.capabilityHost || !isActionHost(this.capabilityHost)) {
      throw new Error('Action confirmation is unavailable.');
    }
    const sessionId = input.sessionId?.trim() || 'jarvis-lab';
    const source = ownerDecisionSourceFrom(input.actionSource);
    this.persistOwnerTurn(
      sessionId,
      ownerConfirmationVisibleText({
        decision: 'deny',
        visibleText: input.visibleText,
        source,
      }),
      source === 'voice' ? 'voice' : source === 'text' ? 'text' : 'ui_action',
    );
    const invoked = await this.capabilityHost.denyProposal(input.proposalId, input.actionSource ?? 'ui');
    return this.finalizeVisibleTurn(sessionId, await this.finishActionTurn(invoked, sessionId, input.speak));
  }

  private hasDeterministicAskReply(
    prepared: Awaited<ReturnType<JarvisLabRuntime['prepareAsk']>>,
  ): boolean {
    const hostResult = prepared.turn.presetActionResults?.some(result => (
      result.capabilityId !== 'intent.conversation'
    ));
    return Boolean(prepared.turn.actionOnly && hostResult)
      || Boolean(prepared.turn.capabilityCalls?.length);
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
    const conversationBound = prepared.resolution.consumed === true && prepared.resolution.source === 'context';
    return {
      route,
      useWork: !conversationBound && !desktopDirect && ((prepared.resolution.goal?.status === 'RESOLVED'
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
  if (kind === 'MODEL_IDENTITY') {
    if (this.agentRuntime && !isCommunityEdition()) {
      let runtimeModel = 'hermes-agent';
      let platform = 'hermes-agent';
      try {
        const capabilities = await this.agentRuntime.getCapabilities();
        runtimeModel = capabilities.model || runtimeModel;
        platform = capabilities.platform || platform;
      } catch {
        // Runtime identity remains Hermes even when the live capability probe is temporarily unavailable.
      }
      const opaqueModel = runtimeModel === 'hermes-agent' || runtimeModel === 'jarvis';
      const thai = /[\u0E00-\u0E7F]/u.test(String(input.text || ''));
      const text = thai
        ? opaqueModel
          ? 'ตอนนี้ JARVIS ใช้ Hermes Agent เป็น primary runtime และให้ Hermes จัดการ model routing/fallback ภายใน โดย API รอบนี้ไม่ได้ยืนยันชื่อ provider model ด้านใน จึงไม่เดาชื่อโมเดล'
          : `ตอนนี้ JARVIS ใช้ Hermes Agent เป็น primary runtime โดย runtime รายงานโมเดล ${runtimeModel}`
        : opaqueModel
          ? 'JARVIS is currently using Hermes Agent as the primary runtime. Hermes manages model routing and fallback internally; this API response does not verify the underlying provider model, so JARVIS will not guess it.'
          : `JARVIS is currently using Hermes Agent as the primary runtime; the runtime reports model ${runtimeModel}.`;
      const identity = { runtime: 'hermes', platform, model: runtimeModel, providerManaged: true, opaqueModel };
      const answer = {
        kind: 'MODEL_IDENTITY' as const,
        text,
        capabilityIds: [] as string[],
        evidence: [`runtime:${platform}`, `runtime-model:${runtimeModel}`, 'routing:provider-managed'],
      };
      const request = createJarvisRequest({ text: String(input.text || ''), sessionId });
      const result: JarvisCoreResult = {
        requestId: request.requestId,
        answerIntent: 'self_knowledge',
        verifiedFacts: [{
          key: 'jarvis.modelIdentity',
          value: identity,
          sourceType: 'system',
          sourceRef: `agent-runtime:${platform}`,
          immutableForPresentation: true,
        }],
        unverifiedClaims: [],
        toolResults: [],
        memoryRefs: [],
        actionResults: [],
        uncertainty: opaqueModel ? ['Underlying provider model is not exposed by the current Hermes runtime identity response.'] : [],
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
        intent: { stage: 'self_knowledge', detail: 'Trusted Hermes runtime identity', kind: answer.kind },
        route: { route: 'CONVERSATION' as const, socialAction: 'SPEAK' as const, agentic: false, reason: 'runtime_model_identity', confidence: 1 },
        selfKnowledge: answer,
        affectStyle: this.commandCenter?.affect.style(),
        ...(speech ? { speech } : {}),
      };
    }
    const selectedId = isCommunityEdition()
      ? (process.env.JARVIS_LLM_MODEL || process.env.LOCAL_QWEN_MODEL || 'local-model')
      : 'qwen38-cyber';
    const identity = trustedRuntimeModelIdentity({
      profile: this.modelProfiles.get(selectedId) || configuredLocalModelProfile({
        id: selectedId,
        displayName: selectedId,
        runtime: 'openai-compatible',
      }),
      selectedId,
    });
    const answer = {
      kind: 'MODEL_IDENTITY' as const,
      text: spokenTrustedModelIdentity(identity),
      capabilityIds: [] as string[],
      evidence: [`profile:${identity.id}`, `displayName:${identity.displayName}`, `alias:${identity.alias}`],
    };
    const request = createJarvisRequest({ text: String(input.text || ''), sessionId });
    const result: JarvisCoreResult = {
      requestId: request.requestId,
      answerIntent: 'self_knowledge',
      verifiedFacts: [{
        key: 'jarvis.modelIdentity',
        value: identity,
        sourceType: 'system',
        sourceRef: `model-identity:${identity.id}`,
        immutableForPresentation: true,
      }],
      unverifiedClaims: [],
      toolResults: [],
      memoryRefs: [],
      actionResults: [],
      uncertainty: [],
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
      intent: { stage: 'self_knowledge', detail: 'Trusted runtime model identity', kind: answer.kind },
      route: { route: 'CONVERSATION' as const, socialAction: 'SPEAK' as const, agentic: false, reason: 'runtime_model_identity', confidence: 1 },
      selfKnowledge: answer,
      affectStyle: this.commandCenter?.affect.style(),
      ...(speech ? { speech } : {}),
    };
  }
  const snapshot = await this.selfKnowledgeSnapshot();
    const question = String(input.text || '');
    const gap = kind === 'CCTV_STATUS' && !isCommunityEdition()
      ? await new CapabilityGapResolver().resolve({
          objective: CCTV_CONNECT_GOAL.title,
          graph: resolveCapabilityGoal(CCTV_CONNECT_GOAL, snapshot),
          snapshot,
        })
      : kind === 'GAP_EXPLANATION'
        ? await resolveSelfKnowledgeGap(question, snapshot)
        : undefined;
    const answer = this.communitySelfKnowledgeAnswer(kind, answerFromSelfKnowledge(kind, snapshot, gap, question));
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
    this.hydrateConversation(sessionId);
    const conversation = this.conversations.get(sessionId);
    const discourse = interpretDiscourse(text, conversation);
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
    const shouldAttemptContinuation = (
      Boolean(input.continuation?.pendingGoalId)
      || Boolean(center?.pendingGoals.store.waiting(sessionId).length)
    ) && !discoursePreemptsPendingGoal(discourse);
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
      context: {
        ...mergeResearchIntoContext(this.intents.get(sessionId), this.research?.snapshot().last, sessionId),
        activeGoalId: conversation.activeGoalId,
        activePlanId: conversation.activePlanId,
        activeProjectSlug: conversation.activeProjectSlug,
        activePreviewUrl: conversation.activePreview?.url,
      },
      conversation,
      aliases: listOwnerAliases(this.memoryStore),
      semanticResolve: !this.agentRuntime && this.llm?.generateText
        ? async (request) => runSemanticResolver(
          input => this.llm!.generateText!(input),
          request.text,
          request.catalog,
          request.context,
        )
        : undefined,
      capabilityHost: this.capabilityHost,
    });
    this.lastConversationBind = {
      sessionId,
      text,
      resolution: prepared.resolution,
      discourse,
    };
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
    if (!(resolution.capabilityId?.startsWith('desktop.open') || resolution.capabilityId === 'desktop.placeWindow' || resolution.capabilityId === 'desktop.focusWindow')) return;
    const existing = this.intents.get(sessionId)?.lastOpenedResource;
    this.intents.touch(sessionId, applyOpenedResource(this.intents.get(sessionId), {
      kind: typeof args.url === 'string' ? 'url' : existing?.kind ?? 'application',
      applicationId: typeof args.applicationId === 'string' ? args.applicationId : existing?.applicationId,
      url: typeof args.url === 'string' ? args.url : existing?.url,
      label: String(args.label || args.applicationId || args.url || existing?.label || resolution.capabilityId || ''),
      display: args.display && typeof args.display === 'object' ? args.display as InteractionContext['lastDisplay'] : existing?.display,
      openState: resolution.capabilityId === 'desktop.placeWindow' || resolution.capabilityId === 'desktop.focusWindow'
        ? existing?.openState ?? 'intended'
        : 'intended',
      windowHandle: typeof args.windowHandle === 'string' ? args.windowHandle : existing?.windowHandle,
      managedWindowId: typeof args.managedWindowId === 'string' ? args.managedWindowId : existing?.managedWindowId,
      processName: existing?.processName,
      currentDisplayId: existing?.currentDisplayId,
      previousDisplayId: existing?.previousDisplayId,
      placementScope: existing?.placementScope,
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
    const action = output.result.actionResults.find(item => (
      String(item.capabilityId || item.name || '').startsWith('desktop.')
    ));
    const structured = action?.structured && typeof action.structured === 'object'
      ? action.structured as Record<string, unknown>
      : {};
    const displayVerified = structured.displayVerified === true || structured.placement === 'placed';
    const tracked = await this.inspectOpenedWindow(sessionId, {
      ...args,
      windowHandle: typeof structured.windowHandle === 'string' ? structured.windowHandle : args.windowHandle,
    });
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
          display: displayVerified && args.display && typeof args.display === 'object'
            ? args.display as InteractionContext['lastDisplay']
            : this.intents.get(sessionId)?.lastDisplay,
          openState: opened || placed
            ? 'opened'
            : (output.pendingConfirmation ? 'intended' : this.intents.get(sessionId)?.lastOpenedResource?.openState ?? 'intended'),
          processName: tracked.processName,
          windowHandle: typeof structured.windowHandle === 'string' ? structured.windowHandle : tracked.windowHandle,
          managedWindowId: typeof structured.managedWindowId === 'string' ? structured.managedWindowId : this.intents.get(sessionId)?.lastOpenedResource?.managedWindowId,
          currentDisplayId: displayVerified ? tracked.displayId : this.intents.get(sessionId)?.lastOpenedResource?.currentDisplayId,
          placementScope: typeof structured.windowHandle === 'string' || tracked.windowHandle ? 'managed-window' : 'unknown',
        }, { verified: displayVerified })
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
      ...sharedTrustedOperatorRuntime().containment.listActive('desktop.focusWindow'),
    ];
    if (!incidents.length) return 'No placement or scoped-open containment is active.';
    const incident = incidents[0]!;
    const context = this.intents.get(sessionId);
    const processName = context?.lastOpenedResource?.processName
      || (incident.affectedTargets.some(target => /^https?:/u.test(target)) ? 'chrome' : undefined);
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
      const query = String(input.text || '');
      text = /จอ|monitor|screen|alias/iu.test(query)
        ? formatAliasAnswer(listOwnerAliases(this.memoryStore, /monitor|screen|จอ/iu.test(query) ? 'display' : undefined))
        : formatOwnerPreferenceAnswer(this.memoryStore, query);
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
        text = written.ok
          ? speakInLanguage(language, {
            en: 'I’ll keep that as an owner preference.',
            th: 'จำไว้แล้วครับ',
          })
          : written.ok === false ? written.message : 'I could not store that preference.';
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
    research: ResearchSnapshot;
    workspace: WorkspaceSnapshot;
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
    if (invoked.capabilityId.startsWith('desktop.open') || invoked.capabilityId === 'desktop.placeWindow' || invoked.capabilityId === 'desktop.focusWindow') {
      const structured = invoked.structured && typeof invoked.structured === 'object'
        ? invoked.structured as Record<string, unknown>
        : {};
      const current = this.intents.get(sessionId);
      const existing = current?.lastOpenedResource;
      const displayVerified = invoked.status === 'ok'
        && (structured.displayVerified === true || structured.placement === 'placed');
      const observedDisplay = displayVerified
        ? observedDisplaySelector(structured) || existing?.display || current?.lastDisplay
        : existing?.display;
      this.intents.touch(sessionId, applyOpenedResource(current, {
        kind: existing?.kind || (typeof structured.url === 'string' ? 'url' : 'application'),
        applicationId: existing?.applicationId,
        url: existing?.url,
        label: existing?.label || invoked.capabilityId,
        display: observedDisplay,
        openState: invoked.status === 'ok' && invoked.capabilityId.startsWith('desktop.open')
          ? 'opened'
          : existing?.openState ?? 'intended',
        processName: existing?.processName,
        windowHandle: typeof structured.windowHandle === 'string' ? structured.windowHandle : existing?.windowHandle,
        managedWindowId: typeof structured.managedWindowId === 'string' ? structured.managedWindowId : existing?.managedWindowId,
        currentDisplayId: displayVerified && typeof structured.displayId === 'string'
          ? structured.displayId
          : existing?.currentDisplayId,
        previousDisplayId: existing?.previousDisplayId,
        placementScope: typeof structured.windowHandle === 'string' || existing?.windowHandle ? 'managed-window' : existing?.placementScope,
      }, { verified: displayVerified }));
    }
    return {
      request,
      result,
      presented,
      timings: { totalMs: 0 },
      coreState: 'complete' as const,
      presentation: await this.presentationStatus(sessionId),
      research: this.researchSnapshot(),
      workspace: this.workspaceSnapshot(),
      ...(speech ? { speech } : {}),
      ...(pending ? { pendingConfirmation: pending } : {}),
    };
  }

  public conversationHistory(input: { sessionId?: string; query?: string; limit?: number } = {}) {
    const history = this.historyStore();
    if (!history) return { sessions: [], turns: [], plans: [] };
    if (input.query) {
      return {
        sessions: history.listSessions(input.limit || 20),
        turns: history.searchVisible(input.query, input.limit || 20),
        plans: this.plans?.list(12) || [],
      };
    }
    const sessionId = input.sessionId?.trim();
    if (sessionId) {
      return {
        sessions: [history.getSession(sessionId)].filter(Boolean),
        turns: history.listTurns(sessionId),
        plans: (this.plans?.list(12) || []).filter(item => item.sessionId === sessionId),
      };
    }
    const sessions = history.listSessions(input.limit || 20);
    return {
      sessions,
      turns: sessions.flatMap(item => history.listTurns(item.id, 12)),
      plans: this.plans?.list(12) || [],
    };
  }

  private historyStore(): ConversationHistoryStore | undefined {
    return this.memoryStore instanceof SqliteJarvisMemoryStore ? this.memoryStore.history : undefined;
  }

  private persistOwnerTurn(sessionId: string, text: string, inputMode: 'voice' | 'text' | 'ui_action'): void {
    const history = this.historyStore();
    if (!history || !text.trim()) return;
    const conv = this.conversations.get(sessionId);
    const plan = (conv.activePlanId && this.plans?.get(conv.activePlanId))
      || this.plans?.latestForSession(sessionId);
    const started = history.startTurn({
      sessionId,
      role: 'OWNER',
      visibleText: text,
      inputMode: inputMode === 'voice' ? 'voice' : 'text',
      modelProfileId: this.configuredModelId(),
      goalId: plan?.goalId,
      planId: plan?.id,
      metadata: { source: inputMode },
    });
    history.completeTurn(started.id, text, { goalId: plan?.goalId, planId: plan?.id });
    const jarvis = history.startTurn({
      sessionId,
      role: 'JARVIS',
      visibleText: '',
      inputMode: 'system-derived',
      modelProfileId: this.configuredModelId(),
    });
    this.activeJarvisTurnId = jarvis.id;
  }

  private finalizeVisibleTurn<T extends {
    presented?: { text?: string };
    result?: {
      memoryRefs?: Array<{ canonicalId?: string }>;
      actionResults?: Array<{
        proposalId?: string;
        name?: string;
        status?: string;
        summary?: string;
        capabilityId?: string;
      }>;
    };
    pendingConfirmation?: { proposalId?: string };
  }>(sessionId: string, output: T): T {
    const compacted = compactVisibleResearch(output);
    const conversation = this.conversations.get(sessionId);
    const researchOutput = (output.result as { toolResults?: Array<{ name?: string; capabilityId?: string }>; verifiedFacts?: Array<{ key?: string }> } | undefined);
    const researched = (researchOutput?.toolResults || []).some(item => String(item.capabilityId || item.name || '').startsWith('research.'))
      || (researchOutput?.verifiedFacts || []).some(item => String(item.key || '').startsWith('citation.'));
    const spoken = researched
      ? String(compacted.presented?.text || '')
      : compactOwnerSpeak(String(compacted.presented?.text || ''), conversation.remembered);
    const visibleOutput = spoken && spoken !== compacted.presented?.text
      ? { ...compacted, presented: { ...compacted.presented, text: spoken } }
      : compacted;
    const visible = String(visibleOutput.presented?.text || '').trim();
    const history = this.historyStore();
    if (history && this.activeJarvisTurnId) {
      if (visible) {
        const plan = this.plans?.latestForSession(sessionId);
        const memoryRefs = (output.result?.memoryRefs || []).map(item => item.canonicalId).filter((id): id is string => Boolean(id));
        const operationRefs = [
          output.pendingConfirmation?.proposalId,
          ...(output.result?.actionResults || []).map(item => item.proposalId),
        ].filter((id): id is string => Boolean(id));
        history.completeTurn(this.activeJarvisTurnId, visible, {
          goalId: plan?.goalId,
          planId: plan?.id,
          memoryRefs,
          operationRefs,
        });
      } else {
        history.markIncomplete(this.activeJarvisTurnId);
      }
    }
    this.activeJarvisTurnId = undefined;
    this.projectMemoryView(sessionId);
    this.recordConversationTurn(sessionId, visibleOutput);
    return {
      ...visibleOutput,
      conversation: this.permissionSnapshot(sessionId).conversation,
    };
  }

  private projectMemoryView(sessionId: string): void {
    const history = this.historyStore();
    if (!this.memoryStore || !history) return;
    try {
      const sessions = history.listSessions(12);
      const turnsBySession = Object.fromEntries(sessions.map(item => [item.id, history.listTurns(item.id)]));
      projectObsidianVault({
        store: this.memoryStore,
        sessions,
        turnsBySession,
        plans: this.plans?.list(12),
      });
      sharedJarvisEventBus().emit('MEMORY_UPDATED', 'Conversation memory projected', { sessionId });
    } catch {
      // Projection is a view; canonical SQLite already holds the turn.
    }
  }

  private dynamicContext(sessionId: string, ownerRequest: string): string {
    const history = this.historyStore();
    const pending = this.workCenter()?.agent.store.active().find(task => task.status === 'WAITING_PERMISSION');
    const memories = this.memoryStore
      ? new JarvisMemoryRetrieval(this.memoryStore).retrieveForTurn({ text: ownerRequest, limit: 8 }).items
      : [];
    this.hydrateConversation(sessionId);
    const conversation = this.conversations.get(sessionId);
    const view = conversationView(conversation);
    const built = buildJarvisContext({
      ownerRequest,
      recentTurns: history?.recentTurns(sessionId, CONTEXT_RECENT_TURN_LIMIT),
      sessionSummary: history?.getSession(sessionId)?.summary,
      activeGoal: conversation.activeGoalId
        ? { id: conversation.activeGoalId }
        : history?.getSession(sessionId)?.activeGoalId
          ? { id: history.getSession(sessionId)!.activeGoalId! }
          : undefined,
      memories,
      plan: (conversation.activePlanId && this.plans?.get(conversation.activePlanId))
        || this.plans?.latestForSession(sessionId)
        || null,
      pendingPermission: pending ? permissionProposalFromBuild({
        title: pending.objective.slice(0, 80),
        slug: pending.id.slice(0, 24),
        capabilityId: pending.permissionRequirements[0] || SOFTWARE_APPLY_BUILD,
      }) : null,
      runtime: { model: this.configuredModelId() },
      projectMemory: [
        view.project ? `Working on ${view.project}` : '',
        view.current ? `Current: ${view.current}` : '',
        view.recent ? `Recent: ${view.recent}` : '',
        ...conversation.constraints.map(item => `Constraint: ${item}`),
        ...conversation.remembered,
      ].filter(Boolean),
    });
    return built.promptBlock;
  }

  private configuredModelId(): string {
    return process.env.JARVIS_LLM_MODEL
      || process.env.LOCAL_QWEN_MODEL
      || (isCommunityEdition() ? 'local-model' : 'qwen38-cyber');
  }

  private offlineModelMessage(): string {
    return isCommunityEdition() ? COMMUNITY_MODEL_OFFLINE_MESSAGE : QWEN_OFFLINE_OWNER_MESSAGE;
  }

  private communitySelfKnowledgeAnswer(
    kind: SelfKnowledgeAnswer['kind'],
    answer: SelfKnowledgeAnswer,
  ): SelfKnowledgeAnswer {
    if (!isCommunityEdition()) return answer;
    if (kind === 'CAPABILITY_SUMMARY' || kind === 'AVAILABLE_NOW') {
      return {
        ...answer,
        text: communityCapabilitySummaryText(),
        capabilityIds: this.capabilityIds.filter(isCommunityCapabilityAllowed),
      };
    }
    if (kind === 'CCTV_STATUS' || kind === 'DEVICE_CONTROL') {
      return {
        kind,
        text: communityUnavailablePrivateText(),
        capabilityIds: [],
        evidence: ['edition:community', 'manifest:excluded'],
      };
    }
    const capabilityIds = answer.capabilityIds.filter(isCommunityCapabilityAllowed);
    if (/cctv|camera|cyber|whonix|nvr|private browser/i.test(answer.text)) {
      return {
        ...answer,
        text: communityCapabilitySummaryText(),
        capabilityIds,
      };
    }
    return { ...answer, capabilityIds };
  }

  private async maybeAgentRuntimeReply(
    input: JarvisLabAskInput,
    prepared: Awaited<ReturnType<JarvisLabRuntime['prepareAsk']>>,
    route: RouteDecision,
  ) {
    if (!this.agentRuntimeConversation || isCommunityEdition()) return undefined;
    const text = String(input.text || '').trim();
    if (!text) return undefined;
    const started = Date.now();
    const request = createJarvisRequest({ text, sessionId: prepared.sessionId });
    try {
      const execution = await this.agentRuntimeConversation.executeReadOnly({
        objective: text,
        binding: {
          jarvisSessionId: prepared.sessionId,
          requestId: request.requestId,
        },
        instructions: [
          'You are the primary cognitive runtime for JARVIS.',
          'Answer the owner directly in the same language they used.',
          'This turn is conversational and READ-ONLY.',
          'Do not claim files, installs, tests, searches, reminders, or system actions happened unless JARVIS supplied evidence.',
          'Do not grant yourself permission or expand scope.',
          'Do not reveal hidden chain-of-thought or scratchpad.',
        ].join('\n'),
        allowedTools: ['tool_describe'],
        verify: ({ finalRun, tools }) => {
          const output = redactSecrets(finalRun.output || '').trim();
          if (finalRun.status === 'completed' && output) {
            return {
              state: 'PARTIALLY_VERIFIED' as const,
              outcome: 'degraded' as const,
              summary: 'Hermes completed inside JARVIS read-only scope; generated content remains unverified model output.',
              evidence: [
                `runtime:${finalRun.runId}`,
                'runtime-status:completed',
                ...tools.map(tool => `runtime-tool:${tool}`),
              ],
            };
          }
          if (finalRun.status === 'cancelled') {
            return {
              state: 'NOT_APPLICABLE' as const,
              outcome: 'cancelled' as const,
              summary: 'Hermes conversation run was cancelled.',
              evidence: [`runtime:${finalRun.runId}`, 'runtime-status:cancelled'],
            };
          }
          return {
            state: 'FAILED_VERIFICATION' as const,
            outcome: 'failure' as const,
            summary: redactSecrets(finalRun.error || 'Hermes did not produce a usable conversational response.').slice(0, 300),
            evidence: [`runtime:${finalRun.runId}`, `runtime-status:${finalRun.status}`],
          };
        },
      });
      const content = redactSecrets(execution.finalRun.output || '').trim();
      if (!content) {
        return await this.agentRuntimeFailureReply(
          input,
          prepared.sessionId,
          route,
          execution.verification.summary,
          started,
        );
      }
      const memoryRefs = execution.memoryProjection
        ? memoryRefsFromItems(execution.memoryProjection.items)
        : [];
      const result: JarvisCoreResult = {
        requestId: request.requestId,
        answerIntent: 'agent_runtime_text',
        verifiedFacts: [{
          key: 'jarvis.agentRuntime',
          value: 'hermes',
          sourceType: 'system',
          sourceRef: `runtime:${execution.finalRun.runId}`,
          confidence: 1,
          immutableForPresentation: true,
        }],
        unverifiedClaims: [{ text: content, confidence: 0.4 }],
        toolResults: execution.tools.map(tool => ({
          toolName: tool,
          status: 'ok' as const,
          summary: 'Observed under JARVIS read-only runtime scope.',
        })),
        memoryRefs,
        actionResults: freezeActionResults([]),
        uncertainty: ['Hermes generated this response; factual claims are not independently verified unless separately supported by JARVIS evidence.'],
        suggestedContent: content,
      };
      const presented = await this.engine.render(
        result,
        this.sessions.resolveTurn(prepared.sessionId, input.oneTurn ? turnOverride(input) : undefined),
        { sessionId: prepared.sessionId },
      );
      const speech = await this.maybeSpeak(
        presented.text,
        request.requestId,
        presented.voiceProfileId,
        input.speak,
      );
      return {
        request,
        result,
        presented,
        timings: { totalMs: Date.now() - started },
        coreState: 'complete' as const,
        presentation: await this.presentationStatus(prepared.sessionId),
        research: this.researchSnapshot(),
        workspace: this.workspaceSnapshot(),
        intent: prepared.intent,
        route,
        affectStyle: this.workCenter()?.affect.style(),
        ...(speech ? { speech } : {}),
      };
    } catch (error) {
      const detail = redactSecrets(error instanceof Error ? error.message : String(error)).slice(0, 300);
      return await this.agentRuntimeFailureReply(input, prepared.sessionId, route, detail, started);
    }
  }

  private async agentRuntimeFailureReply(
    input: JarvisLabAskInput,
    sessionId: string,
    route: RouteDecision,
    detail: string,
    started: number,
  ) {
    const message = detail
      ? `Hermes primary runtime is unavailable or did not complete safely: ${detail}. No blind local-model retry was started.`
      : 'Hermes primary runtime is unavailable or did not complete safely. No blind local-model retry was started.';
    const request = createJarvisRequest({ text: String(input.text || ''), sessionId });
    const result: JarvisCoreResult = {
      requestId: request.requestId,
      answerIntent: 'agent_runtime_unavailable',
      verifiedFacts: [{
        key: 'jarvis.agentRuntime',
        value: 'hermes',
        sourceType: 'system',
        confidence: 1,
        immutableForPresentation: true,
      }],
      unverifiedClaims: [],
      toolResults: [],
      memoryRefs: [],
      actionResults: freezeActionResults([]),
      uncertainty: [message],
      suggestedContent: message,
    };
    const presented = await this.engine.render(result, this.sessions.resolveTurn(sessionId), { sessionId });
    const speech = await this.maybeSpeak(message, request.requestId, presented.voiceProfileId, input.speak);
    return {
      request,
      result,
      presented: { ...presented, text: message },
      timings: { totalMs: Date.now() - started },
      coreState: 'complete' as const,
      presentation: await this.presentationStatus(sessionId),
      research: this.researchSnapshot(),
      workspace: this.workspaceSnapshot(),
      route,
      affectStyle: this.workCenter()?.affect.style(),
      ...(speech ? { speech } : {}),
    };
  }

  private async maybeOfflineModelReply(input: JarvisLabAskInput, sessionId: string) {
    if (!this.llmGeneratesAnswers || !this.llm?.getRuntimeStatus) return undefined;
    try {
      const runtime = await this.llm.getRuntimeStatus();
      const health = asModelHealth(runtime.health);
      if (!health || health === 'MODEL_READY') return undefined;
      const message = isCommunityEdition()
        ? this.offlineModelMessage()
        : runtime.ownerMessage || ownerMessageForModelHealth(health) || this.offlineModelMessage();
      sharedJarvisEventBus().emit('MODEL_STATUS_CHANGED', message, { health }, 'warn');
      const request = createJarvisRequest({ text: String(input.text || ''), sessionId });
      const result: JarvisCoreResult = {
        requestId: request.requestId,
        answerIntent: 'model_offline',
        verifiedFacts: [{ key: 'jarvis.model.health', value: health, sourceType: 'system', immutableForPresentation: true }],
        unverifiedClaims: [],
        toolResults: [],
        memoryRefs: [],
        actionResults: freezeActionResults([]),
        uncertainty: [message],
        suggestedContent: message,
      };
      const presented = await this.engine.render(result, this.sessions.resolveTurn(sessionId), { sessionId });
      return {
        request,
        result,
        presented: { ...presented, text: message },
        timings: { totalMs: 0 },
        coreState: 'complete' as const,
        presentation: await this.presentationStatus(sessionId),
        research: this.researchSnapshot(),
        workspace: this.workspaceSnapshot(),
      };
    } catch {
      return undefined;
    }
  }

  private async grantPendingFromText(
    input: JarvisLabAskInput,
    prepared: {
      sessionId: string;
      resolution: IntentResolution;
    },
  ) {
    if (prepared.resolution.reasonCode !== 'GRANT_PENDING_PERMISSION') return undefined;
    if (!this.capabilityHost || !isActionHost(this.capabilityHost)) return undefined;
    const pending = this.capabilityHost.hydratePendingConfirmation?.(prepared.sessionId)
      || this.capabilityHost.runtimePermissionView?.()?.pending;
    if (!pending?.proposalId || !pending.token) return undefined;
    return await this.confirmAction({
      proposalId: pending.proposalId,
      token: pending.token,
      sessionId: prepared.sessionId,
      speak: input.speak,
      actionSource: input.actionSource === 'voice' ? 'voice' : 'text',
      duration: 'THIS_GOAL',
      visibleText: String(input.text || ''),
      alreadyPersisted: true,
    });
  }

  private async continueApprovedPlan(input: JarvisLabAskInput, sessionId: string) {
    if (!isPlanApprovalUtterance(String(input.text || '')) || !this.plans || !this.capabilityHost) return undefined;
    this.hydrateConversation(sessionId);
    const current = this.conversations.get(sessionId);
    const plan = (current.activePlanId && this.plans.get(current.activePlanId))
      || this.plans.latestForSession(sessionId);
    if (!plan) return undefined;
    if (!['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'WAITING_PERMISSION'].includes(plan.status)) return undefined;
    if (plan.status === 'READY_FOR_REVIEW' || plan.status === 'DRAFT') {
      this.plans.setStatus(plan.id, 'APPROVED');
      sharedJarvisEventBus().emit('PLAN_APPROVED', `Plan approved: ${plan.title}`, { planId: plan.id, goalId: plan.goalId });
    }
    const invoked = await this.capabilityHost.invoke({
      id: SOFTWARE_APPLY_BUILD,
      input: { planId: plan.id, brief: plan.title, goalId: plan.goalId },
      source: input.actionSource === 'voice' ? 'voice' : 'text',
      sessionId,
    });
    this.lastConversationBind = {
      sessionId,
      text: String(input.text || ''),
      resolution: {
        kind: 'CAPABILITY',
        capabilityId: SOFTWARE_APPLY_BUILD,
        arguments: { planId: plan.id, goalId: plan.goalId },
        confidence: 'HIGH',
        reasonCode: 'CONVERSATION_APPROVE_PLAN',
        consumed: true,
        source: 'context',
        actionClass: 'ACTIONABLE',
      },
      discourse: interpretDiscourse(String(input.text || ''), this.conversations.get(sessionId)),
    };
    return this.finishActionTurn(invoked, sessionId, input.speak);
  }

  private hydrateConversation(sessionId: string): ConversationState {
    const current = this.conversations.get(sessionId);
    const sessionPlans = (this.plans?.list(12) || []).filter(item => item.sessionId === sessionId);
    const latest = (current.activePlanId && this.plans?.get(current.activePlanId))
      || this.plans?.latestForSession(sessionId)
      || sessionPlans[0];
    const preview = sharedTrustedOperatorRuntime().devServers?.list().find(item => (
      item.status === 'running' || item.status === 'starting' || item.status === 'unknown'
    ));
    const pending = isActionHost(this.capabilityHost)
      ? this.capabilityHost.runtimePermissionView?.()?.pending
        || this.capabilityHost.hydratePendingConfirmation?.(sessionId)
      : undefined;
    const slug = current.activeProjectSlug || latest?.slug || slugFromWorkspacePath(preview?.workspace);
    const knownSlugs = new Set(current.projects.map(item => item.slug).filter(Boolean));
    const planProjects = sessionPlans
      .filter(plan => !knownSlugs.size || knownSlugs.has(plan.slug) || plan.id === latest?.id || plan.slug === slug)
      .map(plan => ({
        slug: plan.slug,
        label: plan.title,
        kind: plan.projectType === 'WEBSITE' ? 'website' as const : 'software' as const,
        goalId: plan.goalId,
        planId: plan.id,
        workspace: jarvisWorkspaceLogicalPath(plan.slug),
      }));
    const stackedPlan = (current.topicStack || []).find(frame => (
      frame.projectSlug === (current.activeProjectSlug || slug) && frame.planId
    ))?.planId;
    const matchingPlan = latest && latest.id === (current.activePlanId || latest.id) ? latest : latest;
    const leftoverLatest = Boolean(stackedPlan && matchingPlan && matchingPlan.id !== stackedPlan);
    const reviewPlan = matchingPlan && (matchingPlan.status === 'READY_FOR_REVIEW' || matchingPlan.status === 'DRAFT')
      && (!current.activePlanId || matchingPlan.id === current.activePlanId)
      && !leftoverLatest
      ? matchingPlan
      : undefined;
    return this.conversations.hydrate({
      sessionId,
      projects: planProjects.filter(item => (
        !stackedPlan
        || item.slug !== (current.activeProjectSlug || slug)
        || item.planId === stackedPlan
        || item.planId === current.activePlanId
      )),
      activeProjectSlug: slug,
      activePlanId: leftoverLatest ? (current.activePlanId === matchingPlan?.id ? stackedPlan : (current.activePlanId || stackedPlan)) : (current.activePlanId || latest?.id),
      activeGoalId: current.activeGoalId || latest?.goalId,
      pendingPlanReview: reviewPlan
        ? { planId: reviewPlan.id, goalId: reviewPlan.goalId, title: reviewPlan.title }
        : null,
      pendingPermission: pending?.proposalId
        ? {
          proposalId: pending.proposalId,
          goalId: pending.permissionProposal?.goalId || current.pendingPermission?.goalId,
          planId: pending.permissionProposal?.planId || current.pendingPermission?.planId,
        }
        : null,
      preview: preview
        ? {
          url: preview.url,
          port: preview.port,
          processRef: preview.processRef,
          slug: slugFromWorkspacePath(preview.workspace),
        }
        : undefined,
    });
  }

  private recordConversationTurn(
    sessionId: string,
    output: {
      presented?: { text?: string };
      result?: { actionResults?: Array<{ name?: string; status?: string; summary?: string; capabilityId?: string }> };
      pendingConfirmation?: { proposalId?: string };
    },
  ): void {
    const bound = this.lastConversationBind?.sessionId === sessionId ? this.lastConversationBind : undefined;
    const ownerText = bound?.text || '';
    if (!ownerText && !output.presented?.text) return;
    const current = this.conversations.get(sessionId);
    const discourse = bound?.discourse || interpretDiscourse(ownerText, current);
    const resolution = bound?.resolution || {
      kind: 'CONVERSATION' as const,
      confidence: 'HIGH' as const,
      reasonCode: 'TURN',
      consumed: false,
      source: 'heuristic' as const,
      actionClass: 'CONVERSATION' as const,
    };
    const snapshot = this.permissionSnapshotWithoutHydrate(sessionId);
    const action = [...(output.result?.actionResults || [])].reverse().find(item => (
      item.capabilityId && !String(item.capabilityId).startsWith('intent.')
    ));
    const kind = operationKindFromCapability(action?.capabilityId);
    const createdPlan = /CONVERSATION_NEW_PROJECT|CONVERSATION_PLAN|CONVERSATION_PLAN_REQUEST|CONVERSATION_MERGE_PLAN/.test(bound?.resolution.reasonCode || '')
      || action?.capabilityId === 'software.planBuild';
    const currentPlan = current.activePlanId ? this.plans?.get(current.activePlanId) : undefined;
    const plan = createdPlan
      ? (this.plans?.latestForSession(sessionId) || snapshot.plan)
      : (currentPlan || snapshot.plan || this.plans?.latestForSession(sessionId));
    this.conversations.patch(sessionId, state => applyTurnToConversation(state, {
      ownerText,
      discourse,
      resolution,
      replyText: output.presented?.text,
      preview: snapshot.preview
        ? {
          url: snapshot.preview.url,
          port: snapshot.preview.port,
          processRef: snapshot.preview.processRef,
          slug: slugFromWorkspacePath(snapshot.preview.workspace),
        }
        : undefined,
      operation: kind && !isOperationalNoise(action?.summary)
        ? {
          kind,
          capabilityId: action?.capabilityId,
          slug: plan?.slug,
          ok: action?.status === 'completed' || action?.status === 'ok',
          summary: action?.summary || kind,
          at: Date.now(),
        }
        : undefined,
      pendingPermission: output.pendingConfirmation?.proposalId
        ? { proposalId: output.pendingConfirmation.proposalId, goalId: plan?.goalId, planId: plan?.id }
        : snapshot.pendingPermission
          ? snapshot.pendingPermission
          : null,
      pendingPlanReview: plan && (plan.status === 'READY_FOR_REVIEW' || plan.status === 'DRAFT')
        ? { planId: plan.id, goalId: plan.goalId, title: plan.title }
        : null,
      project: (() => {
        const restored = discourse.act === 'RESTORE_TOPIC'
          ? restoreProject(current, ownerText)
          : undefined;
        const chosen = restored || plan;
        if (!chosen) return undefined;
        return {
          slug: restored?.slug || plan!.slug,
          label: restored?.label || plan!.title,
          kind: restored?.kind || (this.plans?.get(plan!.id)?.projectType === 'WEBSITE' ? 'website' : 'software'),
          goalId: restored?.goalId || plan!.goalId,
          planId: restored?.planId || plan!.id,
        };
      })(),
    }));
  }

  private permissionSnapshotWithoutHydrate(sessionId: string): PermissionRuntimeSnapshot {
    const view = isActionHost(this.capabilityHost)
      ? this.capabilityHost.runtimePermissionView?.()
      : undefined;
    const pending = view?.pending
      || (!view && isActionHost(this.capabilityHost)
        ? this.capabilityHost.hydratePendingConfirmation?.(sessionId)
        : undefined);
    const conversationState = this.conversations.get(sessionId);
    const plan = (conversationState.activePlanId && this.plans?.get(conversationState.activePlanId))
      || this.plans?.latestForSession(sessionId)
      || null;
    const preview = sharedTrustedOperatorRuntime().devServers?.list().find(item => (
      item.status === 'running' || item.status === 'starting' || item.status === 'unknown'
    )) || null;
    return {
      pendingPermission: pending || null,
      permissionRecord: view?.record || null,
      lease: view?.lease || null,
      plan: plan ? {
        id: plan.id,
        goalId: plan.goalId,
        title: plan.title,
        slug: plan.slug,
        status: plan.status,
        summary: plan.summary,
        updatedAt: plan.updatedAt,
      } : null,
      stage: null,
      preview,
      conversation: conversationView(conversationState),
    };
  }
}

export function createJarvisLabRuntime(options: JarvisLabRuntimeOptions = {}): JarvisLabRuntime {
  return new JarvisLabRuntime(options);
}

function asModelHealth(value: string | undefined): ModelHealthStatus | undefined {
  return (MODEL_HEALTH_STATUSES as readonly string[]).includes(value || '')
    ? value as ModelHealthStatus
    : undefined;
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
  conversation?: ConversationState;
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
    conversation: input.conversation,
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
  if (resolution.kind === 'CONVERSATION' && resolution.consumed && (resolution.userMessage || resolution.reasonCode === 'ASK_MEMORY' || resolution.reasonCode === 'REMEMBER_PREFERENCE')) {
    return {
      capabilities: [],
      actionOnly: true,
      presetActionResults: [conversationActionResult(resolution)],
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

function compactVisibleResearch<T extends { presented?: { text?: string }; result?: unknown }>(output: T): T {
  const result = output.result as {
    verifiedFacts?: Array<{ key?: string }>;
    toolResults?: Array<{ name?: string; capabilityId?: string }>;
  } | undefined;
  const research = (result?.toolResults || []).some(item => String(item.capabilityId || item.name || '').startsWith('research.'))
    || (result?.verifiedFacts || []).some(item => String(item.key || '').startsWith('citation.'));
  if (!research || !output.presented?.text) return output;
  const text = compactResearchSpeak(output.presented.text);
  if (text === output.presented.text) return output;
  return {
    ...output,
    presented: { ...output.presented, text },
  };
}

function operationKindFromCapability(capabilityId: string | undefined): NonNullable<ConversationState['recentOperation']>['kind'] | undefined {
  const id = String(capabilityId || '');
  if (!id) return undefined;
  if (id.includes('runTests')) return 'test';
  if (id.includes('project.build') || id.endsWith('.build')) return 'build';
  if (id.includes('startDevServer')) return 'preview';
  if (id.includes('stopDevServer')) return 'stop';
  if (id.includes('install')) return 'install';
  if (id.includes('applyBuild') || id.includes('writeFile')) return 'write';
  if (id.includes('planBuild')) return 'plan';
  if (id.includes('research')) return 'research';
  return 'inspect';
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

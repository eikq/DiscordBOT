import path from 'node:path';
import { WorkAgent, WorkTaskStore, newStepId, planForGoalResolution, type PlanStep, type PermissionGrantInput, type WorkStepInvoker, type WorkStepResult, type WorkTask } from '../agent';
import { adaptPlanForFailures } from '../agent/adaptivePlan';
import { createCapabilityWorkInvoker } from '../agent/capabilityInvoker';
import { inferCapabilityFromObjective, planForObjective } from '../agent/capabilityResolve';
import { synthesizeTaskResponse } from '../agent/synthesize';
import { routeJarvisRequest, type RouteDecision } from '../intent/requestRouter';
import type { JarvisMemoryStore } from '../../bot/memory/jarvis/store';
import { writeExperienceEpisode } from '../memory/experienceBridge';
import { runCloudBenchmarkBank } from '../evolution/benchmarkFixtures';
import type { CapabilityHost } from '../capabilities/types';
import { OwnerControl, type OwnerControlState } from '../control';
import { CCTV_CONNECT_GOAL, SimulatedDeviceProvider, cctvCapabilityContracts, type DeviceProvider, type DeviceRecord } from '../devices';
import { isCommunityProviderLock } from '../edition/providers';
import {
  CapabilityGapResolver,
  buildSelfKnowledgeSnapshot,
  resolveCapabilityGoal,
  type GapResolutionPlan,
  type SelfKnowledgeSnapshot,
} from '../intelligence';
import {
  AffectEngine,
  BenchmarkBank,
  CandidateManager,
  CapabilitySelfModel,
  ClaimStore,
  ExperienceStore,
  FailureLedger,
  GrowthPlanner,
  ModelAdaptationRegistry,
  NightCycle,
  PracticeEngine,
  ReflectionLedger,
  SkillVersionRegistry,
  applyTaskOutcome,
  buildEvolutionGraph,
  buildJournal,
  createCandidateSandbox,
  EvolutionPersistence,
  reflectStructured,
  type EvolutionGraph,
  type JarvisJournal,
  type NightCycleReport,
} from '../evolution';
import { defaultRuntimeRoot } from '../storage/operationalDb';
import { ProactiveMonitor, type MonitorSignal } from '../monitor';
import { visualStateFromEvents } from '../ops/visualState';
import type { JarvisVisualState } from '../ops/types';
import { sharedJarvisEventBus, type JarvisEventBus } from '../security/eventBus';
import { SimulatedScreenCapture, SimulatedVisionAnalyzer, type VisualContext } from '../vision';
import type { JarvisOperationEvent } from '../security/types';
import {
  PendingGoalCoordinator,
  PendingGoalStore,
  resolveOwnerGoal,
  type ContinuePendingGoalInput,
  type GoalResolution,
  type PendingGoalContinuation,
  type PendingGoalRecord,
} from '../goals';
import { sharedTrustedOperatorRuntime, type TrustedOperatorRuntime } from '../security/trustedOperatorRuntime';
import { redactSecrets } from '../security/redaction';
import { presentCommandCenter } from './commandCenterView';
import type { DemoScenarioId } from './commandCenterHttp';

export type CommandCenterSnapshot = {
  simulationMode: boolean;
  visualState: JarvisVisualState;
  operations: JarvisOperationEvent[];
  task: WorkTask | null;
  tasks: WorkTask[];
  evolution: {
    experiences: number;
    reflections: number;
    skills: number;
    failures: number;
    goals: string[];
    journal: JarvisJournal;
    graph: EvolutionGraph;
    night: NightCycleReport;
    affect: ReturnType<AffectEngine['snapshot']>;
    affectStyle: ReturnType<AffectEngine['style']>;
    selfModel: ReturnType<CapabilitySelfModel['matrix']>;
    candidates: ReturnType<CandidateManager['list']>;
    benchmarks: ReturnType<BenchmarkBank['latest']>;
    modelAdaptation: { trained: false; candidates: number; nextAfterPolicy: string | null };
  };
  request: { route: RouteDecision; objective: string; taskId?: string } | null;
  permission: {
    waiting: boolean;
    taskId?: string;
    stepId?: string;
    capability?: string;
    proposalId?: string;
    preflight?: import('../safety/types').ActionPreflight;
  };
  memoryActivity: { experiences: number; reflections: number; skills: number };
  devices: DeviceRecord[];
  vision: VisualContext | null;
  control: OwnerControlState;
  notifications: MonitorSignal[];
};

export type CommandCenterOptions = {
  events?: JarvisEventBus;
  now?: () => number;
  simulated?: boolean;
  invoke?: WorkStepInvoker;
  host?: CapabilityHost;
  persistRoot?: string;
  workDbPath?: string;
  evolutionDbPath?: string;
  pendingGoalDbPath?: string;
  pendingGoalTtlMs?: number;
  memoryStore?: JarvisMemoryStore;
  operator?: TrustedOperatorRuntime;
};

export class CommandCenterRuntime {
  public readonly events: JarvisEventBus;
  public readonly control: OwnerControl;
  public readonly agent: WorkAgent;
  public readonly experiences: ExperienceStore;
  public readonly claims: ClaimStore;
  public readonly skills: SkillVersionRegistry;
  public readonly failures: FailureLedger;
  public readonly selfModel: CapabilitySelfModel;
  public readonly growth: GrowthPlanner;
  public readonly practice = new PracticeEngine();
  public readonly benchmarks: BenchmarkBank;
  public readonly affect = new AffectEngine();
  public readonly candidates: CandidateManager;
  public readonly modelAdaptation = new ModelAdaptationRegistry();
  public readonly monitor = new ProactiveMonitor();
  public readonly devices: DeviceProvider;
  public readonly visionCapture = new SimulatedScreenCapture();
  public readonly visionAnalyzer = new SimulatedVisionAnalyzer();
  public readonly night: NightCycle;
  public readonly reflectionLedger: ReflectionLedger;
  public readonly operator: TrustedOperatorRuntime;
  public readonly pendingGoals: PendingGoalCoordinator;
  public readonly persistence?: EvolutionPersistence;
  private host?: CapabilityHost;
  private readonly pendingResumeClaims = new Set<string>();
  private vision: VisualContext | null = null;
  private notifications: MonitorSignal[] = [];
  private memoryStore?: JarvisMemoryStore;
  private lastRequest: { route: RouteDecision; objective: string; taskId?: string } | null = null;
  private lastSessionId?: string;
  private readonly gapResolver = new CapabilityGapResolver();

  constructor(options: CommandCenterOptions = {}) {
    this.devices = isCommunityProviderLock()
      ? { list: () => [], capability: () => false }
      : new SimulatedDeviceProvider();
    const simulated = Boolean(options.simulated);
    this.events = options.events ?? sharedJarvisEventBus();
    this.operator = options.operator ?? sharedTrustedOperatorRuntime();
    this.host = options.host;
    this.control = new OwnerControl({
      maxAutonomy: 2,
      currentAutonomy: 1,
      researchDepth: 'standard',
      backgroundEvolution: false,
      nightCycle: false,
      proactiveAlerts: true,
      simulationMode: simulated,
    });
    const persistRoot = options.persistRoot;
    const evolutionDb = options.evolutionDbPath ?? (persistRoot ? path.join(persistRoot, 'evolution.db') : undefined);
    const workDb = options.workDbPath ?? (persistRoot ? path.join(persistRoot, 'work.db') : undefined);
    const pendingGoalDb = options.pendingGoalDbPath ?? (persistRoot ? path.join(persistRoot, 'pending-goals.db') : undefined);
    this.persistence = evolutionDb ? new EvolutionPersistence(evolutionDb) : undefined;
    const now = options.now ?? (() => Date.now());
    this.experiences = new ExperienceStore(now, this.persistence?.experiences);
    this.claims = new ClaimStore(now, this.persistence?.claims);
    this.skills = new SkillVersionRegistry(this.persistence?.skills);
    this.failures = new FailureLedger(this.persistence?.failures);
    this.selfModel = new CapabilitySelfModel(now, this.persistence?.selfModel);
    this.growth = new GrowthPlanner(this.persistence?.growth);
    this.candidates = new CandidateManager(this.persistence?.candidates);
    this.reflectionLedger = new ReflectionLedger(this.persistence?.reflections);
    this.benchmarks = new BenchmarkBank(now, this.persistence?.benchmarks);
    this.memoryStore = options.memoryStore;
    this.agent = new WorkAgent({
      store: new WorkTaskStore({ now: options.now, dbPath: workDb }),
      events: this.events,
      now: options.now,
      invoke: options.invoke ?? createCapabilityWorkInvoker({
        host: () => this.host,
        sessionId: () => this.lastSessionId,
        researchDepth: () => this.control.snapshot().researchDepth,
      }),
      simulated,
      emergency: this.operator.emergency,
      resolveGap: (task, step, result, attempted, maximum) => this.resolveWorkGap(task, step, result, attempted, maximum),
      onTerminal: task => this.recordTaskExperience(task),
    });
    this.pendingGoals = new PendingGoalCoordinator({
      store: new PendingGoalStore({ now: options.now, ttlMs: options.pendingGoalTtlMs, dbPath: pendingGoalDb }),
      host: () => this.host,
      events: this.events,
      now: options.now,
    });
    this.night = new NightCycle({
      experiences: this.experiences,
      skills: this.skills,
      failures: this.failures,
      selfModel: this.selfModel,
      growth: this.growth,
      reflections: this.reflectionLedger,
      persistReport: report => this.persistence?.night.replace([{ ...report, id: 'latest' }]),
      events: this.events,
      now: options.now,
      simulated,
      runBenchmarks: () => runCloudBenchmarkBank(this.benchmarks, now).length,
    });
  }

  public attachCapabilities(host: CapabilityHost): void {
    this.host = host;
  }

  public async selfKnowledgeSnapshot(): Promise<SelfKnowledgeSnapshot> {
    return buildSelfKnowledgeSnapshot({
      host: this.host,
      selfModel: this.selfModel,
      declarations: cctvCapabilityContracts(),
    });
  }

  public attachMemoryStore(store: JarvisMemoryStore): void {
    this.memoryStore = store;
  }

  public snapshot(): CommandCenterSnapshot {
    this.refreshPendingGoalExpirations();
    const tasks = this.agent.store.list();
    const active = selectPresentedWorkTask(this.agent.store.active());
    const experiences = this.experiences.list();
    const reflections = this.reflectionLedger.list();
    return {
      simulationMode: this.control.snapshot().simulationMode,
      visualState: visualStateFromEvents(this.events.recent(12)),
      operations: this.events.recent(40),
      task: active,
      tasks,
      evolution: {
        experiences: experiences.length,
        reflections: reflections.length,
        skills: this.skills.list().length,
        failures: this.failures.list().length,
        goals: this.growth.active().map(item => item.title),
        journal: buildJournal({
          experiences,
          assessments: this.selfModel.matrix(),
          failures: this.failures.list(),
          goals: this.growth.list(),
          night: this.night.snapshot(),
        }),
        graph: buildEvolutionGraph({
          experiences: experiences.map(item => ({ id: item.id, goal: item.goal, outcome: item.outcome })),
          reflections: reflections.map(item => ({ experienceId: item.experienceId, reusableLesson: item.reusableLesson })),
          skills: this.skills.list().map(item => ({ skillId: item.skillId, version: item.version, purpose: item.purpose, evidence: item.evidence })),
          goals: this.growth.list(),
          failures: this.failures.list(),
        }),
        night: this.night.snapshot(),
        affect: this.affect.snapshot(),
        affectStyle: this.affect.style(),
        selfModel: this.selfModel.matrix(),
        candidates: this.candidates.list(),
        benchmarks: this.benchmarks.latest(),
        modelAdaptation: {
          trained: false,
          candidates: this.modelAdaptation.list().length,
          nextAfterPolicy: this.modelAdaptation.nextLayer('POLICY'),
        },
      },
      request: this.lastRequest,
      permission: permissionOf(active),
      memoryActivity: {
        experiences: experiences.length,
        reflections: reflections.length,
        skills: this.skills.list().length,
      },
      devices: this.devices.list(),
      vision: this.vision,
      control: this.control.snapshot(),
      notifications: [...this.notifications],
    };
  }

  public async runDemo(name: DemoScenarioId): Promise<CommandCenterSnapshot> {
    this.control.patch({ simulationMode: true }, 'owner');
    this.events.emit('SIMULATION', `Demo scenario ${name}`, { scenario: name }, 'info', {
      simulated: true,
      visualState: 'UNDERSTANDING',
    });
    if (name === 'research') await this.demoResearch();
    else if (name === 'coding') await this.demoCoding();
    else if (name === 'evolution') await this.demoEvolution();
    else await this.demoMonitoring();
    return this.snapshot();
  }

  public recordTaskExperience(task: WorkTask): void {
    const result = applyTaskOutcome(task, {
      experiences: this.experiences,
      reflections: this.reflectionLedger,
      failures: this.failures,
      skills: this.skills,
      selfModel: this.selfModel,
      growth: this.growth,
      affect: this.affect,
      events: this.events,
    });
    if (result.experience && !result.duplicate && this.memoryStore) {
      writeExperienceEpisode(this.memoryStore, result.experience, task);
    }
  }

  public async runObjective(objective: string, options: { simulated?: boolean; sessionId?: string; goalResolution?: GoalResolution } = {}): Promise<WorkTask> {
    this.lastSessionId = options.sessionId;
    const simulated = Boolean(options.simulated || this.control.snapshot().simulationMode);
    if (simulated) this.control.patch({ simulationMode: true }, 'owner');
    const resolvedGoal = options.goalResolution ?? await resolveOwnerGoal(objective, { host: this.host });
    const executableGoal = resolvedGoal.status === 'RESOLVED' && resolvedGoal.handler === 'CAPABILITY_PLAN'
      ? resolvedGoal
      : undefined;
    const capabilityId = executableGoal?.routes.find(item => item.id === executableGoal.selectedRouteId)?.steps[0]?.capabilityId
      ?? inferCapabilityFromObjective(objective, this.host);
    const routed = routeJarvisRequest({ text: objective });
    const route = capabilityId && routed.route === 'CONVERSATION'
      ? { ...routed, route: 'CAPABILITY' as const, agentic: true, reason: 'bound_capability' }
      : routed;
    const trustedSkills = this.skills.retrieveTrusted(objective);
    const plan = adaptPlanForFailures(
      executableGoal ? planForGoalResolution(objective, executableGoal) : planForObjective(objective, capabilityId),
      this.failures,
      trustedSkills,
    );
    const task = this.agent.receive(objective, plan, { simulated, goalResolution: executableGoal });
    this.lastRequest = { route, objective, taskId: task.id };
    return this.agent.run(task.id);
  }

  public beginPendingGoal(input: {
    objective: string;
    sessionId: string;
    resolution: GoalResolution;
    simulated?: boolean;
  }): { pendingGoal: PendingGoalRecord; task: WorkTask } {
    const safeObjective = redactSecrets(input.objective).slice(0, 1_000);
    let pendingGoal = this.pendingGoals.create({
      sessionId: input.sessionId,
      ownerIntent: safeObjective,
      resolution: input.resolution,
    });
    const task = this.agent.receiveWaitingInput({
      objective: safeObjective,
      pendingGoalId: pendingGoal.pendingGoalId,
      question: input.resolution.smallestOwnerQuestion || 'What information should I use?',
      missingFields: input.resolution.missingInputs,
      expiresAt: pendingGoal.expiresAt,
      goalResolution: input.resolution,
      simulated: input.simulated,
    });
    pendingGoal = this.pendingGoals.attachWorkTask(pendingGoal.pendingGoalId, task.id);
    this.lastRequest = { route: routeJarvisRequest({ text: safeObjective }), objective: safeObjective, taskId: task.id };
    return { pendingGoal, task };
  }

  public async continuePendingGoal(input: ContinuePendingGoalInput): Promise<{
    continuation: PendingGoalContinuation;
    task?: WorkTask;
  }> {
    this.refreshPendingGoalExpirations(input.sessionId);
    const continuation = await this.pendingGoals.continue(input);
    const record = continuation.pendingGoal;
    const task = record?.workTaskId ? this.agent.store.get(record.workTaskId) : undefined;
    if (!record || !task) return { continuation };
    if (continuation.status === 'CANCELLED') {
      return { continuation, task: this.agent.cancel(task.id) };
    }
    if (continuation.status === 'EXPIRED') {
      return { continuation, task: this.agent.expireWaitingInput(task.id) };
    }
    if (continuation.status === 'REJECTED' && record.state === 'INVALIDATED') {
      task.waitingInput = undefined;
      task.status = 'BLOCKED';
      task.errors = [...task.errors, {
        at: new Date().toISOString(),
        code: 'PLAN_INVALID',
        message: 'Pending goal definition changed; current GoalCatalog resolution is required.',
      }];
      return { continuation, task: this.agent.store.save(task) };
    }
    if (continuation.status === 'STILL_WAITING' && continuation.resolution) {
      return {
        continuation,
        task: this.agent.updateWaitingInput(task.id, {
          question: continuation.question || 'One more declared input is required.',
          missingFields: continuation.resolution.missingInputs,
          expiresAt: record.expiresAt,
          goalResolution: continuation.resolution,
        }),
      };
    }
    if (continuation.status === 'ALREADY_RESOLVED') {
      return { continuation, task };
    }
    if (continuation.status === 'BLOCKED' && continuation.resolution) {
      const snapshot = await this.selfKnowledgeSnapshot();
      const capabilityIds = [...new Set(continuation.resolution.routes.flatMap(route => route.steps.map(step => step.capabilityId)))];
      const graph = resolveCapabilityGoal({
        id: `pending:${record.pendingGoalId}`,
        title: record.originalOwnerIntent,
        dependencies: capabilityIds.map(capabilityId => ({ capabilityId, relation: 'REQUIRED' as const })),
      }, snapshot);
      const gapResolution = await this.gapResolver.resolve({ objective: record.originalOwnerIntent, graph, snapshot });
      task.gapResolution = gapResolution;
      task.blockers = gapResolution.missing.map(item => ({ capabilityId: item.capabilityId, blocker: item.blocker, reason: item.reason }));
      task.waitingInput = undefined;
      task.status = 'BLOCKED';
      const blocked = this.agent.store.save(task);
      return { continuation: { ...continuation, gapResolution }, task: blocked };
    }
    const restartResume = continuation.status === 'ALREADY_RESUMING' && task.status === 'WAITING_INPUT';
    if ((continuation.status !== 'READY_TO_RESUME' && !restartResume) || !continuation.resolution) return { continuation, task };
    if (!this.operator.emergency.allows('system', 'write')) {
      return {
        continuation: {
          ...continuation,
          status: 'BLOCKED',
          reason: 'Emergency Stop is active. The validated context remains non-authoritative and was not executed.',
        },
        task,
      };
    }
    if (this.pendingResumeClaims.has(record.pendingGoalId)) return { continuation, task: this.agent.store.get(task.id) ?? task };
    this.pendingResumeClaims.add(record.pendingGoalId);
    try {
      const plan = adaptPlanForFailures(
        planForGoalResolution(record.originalOwnerIntent, continuation.resolution),
        this.failures,
        this.skills.retrieveTrusted(record.originalOwnerIntent),
      );
      this.pendingGoals.markResuming(record.pendingGoalId, task.id);
      const resumed = await this.agent.resumeWaitingInput(task.id, plan, continuation.resolution);
      this.pendingGoals.markResolved(record.pendingGoalId, resumed.id);
      return { continuation: { ...continuation, pendingGoal: this.pendingGoals.store.get(record.pendingGoalId) }, task: resumed };
    } finally {
      this.pendingResumeClaims.delete(record.pendingGoalId);
    }
  }

  public refreshPendingGoalExpirations(sessionId?: string): PendingGoalRecord[] {
    const expired = sessionId
      ? this.pendingGoals.expireForSession(sessionId)
      : this.pendingGoals.expireAll();
    for (const record of expired) {
      if (!record.workTaskId) continue;
      this.agent.expireWaitingInput(record.workTaskId);
    }
    return expired;
  }

  public async cctvGapPlan(): Promise<GapResolutionPlan> {
    const snapshot = await this.selfKnowledgeSnapshot();
    const graph = resolveCapabilityGoal(CCTV_CONNECT_GOAL, snapshot);
    return this.gapResolver.resolve({ objective: CCTV_CONNECT_GOAL.title, graph, snapshot });
  }

  public runNight(): NightCycleReport {
    this.assertOperatorRunning();
    return this.night.run();
  }

  public async simulateVision(fixtureId = 'settings_panel'): Promise<VisualContext> {
    const captured = await this.visionCapture.capture(fixtureId);
    this.vision = await this.visionAnalyzer.analyze(captured.imageId);
    this.events.emit('VISION', `Vision fixture ${fixtureId}`, { fixtureId, simulated: true }, 'info', {
      simulated: true,
      visualState: 'UNDERSTANDING',
    });
    return this.vision;
  }

  public present() {
    return presentCommandCenter(this.snapshot());
  }

  public async grantAndResume(taskId: string, stepIdOrGrant?: string | PermissionGrantInput) {
    const granted = this.agent.grantPermission(taskId, stepIdOrGrant);
    if (granted.status === 'READY' || granted.status === 'WAITING_PERMISSION' || granted.status === 'PAUSED') {
      return this.agent.resume(taskId);
    }
    return granted;
  }

  public synthesize(task?: WorkTask) {
    const current = task ?? selectPresentedWorkTask(this.agent.store.active()) ?? this.agent.store.list().at(-1);
    return current ? synthesizeTaskResponse(current) : undefined;
  }

  public runPractice(goalId: string) {
    this.assertOperatorRunning();
    const goal = this.growth.list().find(item => item.id === goalId);
    const exercise = this.practice.exercises(1)[0];
    const result = this.practice.run(exercise?.id || 'practice_planning_dag');
    if (result.passed && goal) {
      this.selfModel.observe('practice', 'success', undefined, {
        verificationState: 'VERIFIED',
        evidenceRefs: [`practice:${exercise?.id || 'practice_planning_dag'}`],
        observationId: `practice:${goalId}:${exercise?.id || 'practice_planning_dag'}`,
      });
    }
    return { goalId, isolated: result.isolated, destructive: result.destructive, passed: result.passed };
  }

  private assertOperatorRunning(): void {
    if (!this.operator.emergency.allows('system', 'write')) {
      throw Object.assign(new Error('Emergency Stop is active. Autonomous work remains suspended.'), {
        reasonCode: 'EMERGENCY_STOP_ACTIVE',
      });
    }
  }

  private async resolveWorkGap(
    task: WorkTask,
    step: PlanStep,
    _result: WorkStepResult,
    attempted: number,
    maximumAttempts: number,
  ): Promise<GapResolutionPlan> {
    const snapshot = await this.selfKnowledgeSnapshot();
    const capabilityId = step.capability?.trim() || `unbound.${step.kind}`;
    const graph = resolveCapabilityGoal({
      id: `goal.task.${task.id}.${step.id}`,
      title: task.objective,
      dependencies: [{ capabilityId, relation: 'REQUIRED' }],
      allowSimulation: Boolean(task.simulated),
    }, snapshot);
    const base = await this.gapResolver.resolve({
      objective: task.objective,
      graph,
      snapshot,
      attempted,
      maximumAttempts,
    });
    const current = step.capability;
    const attemptedRoutes = new Set((task.goalResolution?.evidence ?? [])
      .filter(item => item.startsWith('replan:'))
      .map(item => item.split(':')[1]));
    const alternatives = (task.goalResolution?.routes ?? [])
      .filter(route => route.id !== task.goalResolution?.selectedRouteId)
      .filter(route => !attemptedRoutes.has(route.id))
      .filter(route => !route.steps.some(item => item.capabilityId === current))
      .map(route => ({
        kind: route.steps.length > 1 ? 'COMPOSE_EXISTING_CAPABILITIES' as const : 'USE_EXISTING_CAPABILITY' as const,
        priority: route.priority,
        title: route.ownerDecisionRequired ? `${route.title} requires an owner decision.` : route.title,
        capabilityIds: route.steps.map(item => item.capabilityId),
        risk: route.risk === 'READ_ONLY' ? 'LOW' as const : route.risk,
        ownerInputRequired: [] as string[],
        permissionRequired: route.ownerDecisionRequired ? route.steps.map(item => item.capabilityId) : [],
        externalDependencies: [] as string[],
        researchRequired: false,
        executableNow: route.available && route.inputCompatible && !route.ownerDecisionRequired,
        inputCompatible: route.inputCompatible,
        trustRequired: false,
      }));
    if (alternatives.length === 0) return base;
    const possiblePaths = [...alternatives, ...base.possiblePaths];
    const recommendedPath = attempted < maximumAttempts
      ? possiblePaths.find(item => item.executableNow && item.inputCompatible)
        ?? possiblePaths.find(item => item.permissionRequired.length > 0)
        ?? base.recommendedPath
      : base.recommendedPath;
    return {
      ...base,
      possiblePaths,
      recommendedPath,
      permissionRequired: [...new Set([...base.permissionRequired, ...(recommendedPath?.permissionRequired ?? [])])],
      evidence: [...base.evidence, ...alternatives.flatMap(item => item.capabilityIds.map(id => `declared-alternative:${id}`))],
    };
  }

  public notify(signal: MonitorSignal): ReturnType<ProactiveMonitor['ingest']> {
    const decision = this.monitor.ingest(signal);
    if (decision === 'notify') {
      this.notifications = [...this.notifications, signal].slice(-12);
      this.events.emit('MONITOR', signal.summary, { type: signal.type, simulated: signal.simulated }, signal.severity === 'critical' ? 'error' : 'warn', {
        simulated: signal.simulated,
        visualState: signal.severity === 'critical' ? 'ERROR' : 'DEGRADED',
      });
    }
    return decision;
  }

  private async demoResearch(): Promise<void> {
    const plan: PlanStep[] = demoSteps([
      ['understand', 'Understand the technical question'],
      ['research', 'Search public sources'],
      ['verify', 'Compare evidence'],
    ]);
    const task = this.agent.receive('What is the current official driver policy for the lab GPU?', plan, { simulated: true });
    await this.agent.run(task.id);
  }

  private async demoCoding(): Promise<void> {
    const understand = demoStep('understand', 'Understand the bug');
    const search = demoStep('search', 'Search local workspace', [understand.id]);
    const apply = demoStep('apply', 'Apply a simulated patch', [search.id]);
    const test = demoStep('test', 'Run fixture tests', [apply.id]);
    const verify = demoStep('verify', 'Verify the fix', [test.id]);
    const task = this.agent.receive('Fix a simulated voice latency regression', [understand, search, apply, test, verify], { simulated: true });
    await this.agent.run(task.id);
  }

  private async demoEvolution(): Promise<void> {
    const failed = this.experiences.create({
      kind: 'episodic',
      domain: 'research',
      goal: 'Fetch driver notes',
      situation: 'Provider timed out',
      actions: ['fetch'],
      tools: ['research.fetchSource'],
      result: 'timeout',
      outcome: 'failure',
      lessons: [],
      confidence: 0.4,
      privacyClass: 'private',
      significance: 0.8,
      cause: 'RESEARCH_TIMEOUT',
    });
    this.failures.record(failed, 'RESEARCH_TIMEOUT');
    const reflection = reflectStructured(failed, this.experiences.similarFailures('RESEARCH_TIMEOUT'), 'important_failure');
    this.reflectionLedger.add(reflection);
    if (reflection.skillCandidateAllowed) {
      throw new Error('Failure must not produce a trusted skill candidate.');
    }
    const sandbox = createCandidateSandbox();
    const bad = this.candidates.create({ hypothesis: 'Skip tests', sandboxPath: sandbox, simulated: true });
    this.candidates.evaluate(bad.id, { benchmarkBefore: 0.8, benchmarkAfter: 0.4, testsPassed: false, securityPassed: true });
    const good = this.candidates.create({ hypothesis: 'Prefer official sources', sandboxPath: sandbox, simulated: true });
    this.candidates.evaluate(good.id, { benchmarkBefore: 0.6, benchmarkAfter: 0.8, testsPassed: true, securityPassed: true });
    this.night.run();
    this.events.emit('CANDIDATE_REJECTED', 'Bad candidate rejected', { candidateId: bad.id }, 'warn', { simulated: true });
  }

  private async demoMonitoring(): Promise<void> {
    this.notify({
      id: 'gpu_hot',
      type: 'temperature',
      summary: 'Simulated GPU overheating warning',
      severity: 'critical',
      at: new Date().toISOString(),
      ownerRelevant: true,
      simulated: true,
    });
    this.events.emit('DEVICE', 'Simulated GPU thermal warning', { deviceId: 'sensor_temp', simulated: true }, 'warn', {
      simulated: true,
      visualState: 'DEGRADED',
    });
  }
}

export type { DemoScenarioId } from './commandCenterHttp';

function demoStep(kind: PlanStep['kind'], title: string, dependencies: string[] = []): PlanStep {
  return {
    id: newStepId(kind),
    title,
    kind,
    dependencies,
    status: 'pending',
    riskLevel: 'LOW',
    verificationMethod: 'simulation',
    retryPolicy: { maxAttempts: 1, attempted: 0 },
  };
}

function demoSteps(items: Array<[PlanStep['kind'], string]>): PlanStep[] {
  const steps: PlanStep[] = [];
  for (const [kind, title] of items) {
    steps.push(demoStep(kind, title, steps.length ? [steps[steps.length - 1].id] : []));
  }
  return steps;
}

let sharedCenter: CommandCenterRuntime | undefined;

export function sharedCommandCenter(): CommandCenterRuntime {
  sharedCenter ??= new CommandCenterRuntime({
    events: sharedJarvisEventBus(),
    operator: sharedTrustedOperatorRuntime(),
    simulated: false,
    persistRoot: process.env.JARVIS_RUNTIME_DIR || defaultRuntimeRoot(),
  });
  return sharedCenter;
}

export function resetSharedCommandCenter(): void {
  sharedCenter = undefined;
}

export function selectPresentedWorkTask(tasks: WorkTask[]): WorkTask | null {
  if (!tasks.length) return null;
  const waitingPermission = tasks.find(task => (
    task.status === 'WAITING_PERMISSION'
    || task.plan.some(step => step.status === 'waiting_permission')
  ));
  if (waitingPermission) return waitingPermission;
  const waitingInput = tasks.find(task => task.status === 'WAITING_INPUT');
  if (waitingInput) return waitingInput;
  return tasks[0] ?? null;
}

function permissionOf(task: WorkTask | null): CommandCenterSnapshot['permission'] {
  const waiting = task?.plan.find(step => step.status === 'waiting_permission');
  return {
    waiting: Boolean(waiting),
    taskId: task?.id,
    stepId: waiting?.id,
    capability: waiting?.pendingConfirmation?.capability || waiting?.capability,
    proposalId: waiting?.pendingConfirmation?.proposalId,
    preflight: waiting?.pendingConfirmation?.preflight || waiting?.preflight,
  };
}

import path from 'node:path';
import { WorkAgent, WorkTaskStore, newStepId, type PlanStep, type PermissionGrantInput, type WorkStepInvoker, type WorkTask } from '../agent';
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
import { SimulatedDeviceProvider, type DeviceRecord } from '../devices';
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
  memoryStore?: JarvisMemoryStore;
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
  public readonly devices = new SimulatedDeviceProvider();
  public readonly visionCapture = new SimulatedScreenCapture();
  public readonly visionAnalyzer = new SimulatedVisionAnalyzer();
  public readonly night: NightCycle;
  public readonly reflectionLedger: ReflectionLedger;
  public readonly persistence?: EvolutionPersistence;
  private host?: CapabilityHost;
  private vision: VisualContext | null = null;
  private notifications: MonitorSignal[] = [];
  private memoryStore?: JarvisMemoryStore;
  private lastRequest: { route: RouteDecision; objective: string; taskId?: string } | null = null;

  constructor(options: CommandCenterOptions = {}) {
    const simulated = Boolean(options.simulated);
    this.events = options.events ?? sharedJarvisEventBus();
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
        researchDepth: () => this.control.snapshot().researchDepth,
      }),
      simulated,
      onTerminal: task => this.recordTaskExperience(task),
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

  public attachMemoryStore(store: JarvisMemoryStore): void {
    this.memoryStore = store;
  }

  public snapshot(): CommandCenterSnapshot {
    const tasks = this.agent.store.list();
    const active = this.agent.store.active()[0] ?? null;
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

  public async runObjective(objective: string, options: { simulated?: boolean; sessionId?: string } = {}): Promise<WorkTask> {
    const simulated = Boolean(options.simulated || this.control.snapshot().simulationMode);
    if (simulated) this.control.patch({ simulationMode: true }, 'owner');
    const capabilityId = inferCapabilityFromObjective(objective, this.host);
    const routed = routeJarvisRequest({ text: objective });
    const route = capabilityId && routed.route === 'CONVERSATION'
      ? { ...routed, route: 'CAPABILITY' as const, agentic: true, reason: 'bound_capability' }
      : routed;
    const trustedSkills = this.skills.retrieveTrusted(objective);
    const plan = adaptPlanForFailures(
      planForObjective(objective, capabilityId),
      this.failures,
      trustedSkills,
    );
    const task = this.agent.receive(objective, plan, { simulated });
    this.lastRequest = { route, objective, taskId: task.id };
    return this.agent.run(task.id);
  }

  public runNight(): NightCycleReport {
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
    const current = task ?? this.agent.store.active()[0] ?? this.agent.store.list().at(-1);
    return current ? synthesizeTaskResponse(current) : undefined;
  }

  public runPractice(goalId: string) {
    const goal = this.growth.list().find(item => item.id === goalId);
    const exercise = this.practice.exercises(1)[0];
    const result = this.practice.run(exercise?.id || 'practice_planning_dag');
    if (result.passed && goal) {
      this.selfModel.observe('practice', 'success');
    }
    return { goalId, isolated: result.isolated, destructive: result.destructive, passed: result.passed };
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
    simulated: false,
    persistRoot: process.env.JARVIS_RUNTIME_DIR || defaultRuntimeRoot(),
  });
  return sharedCenter;
}

export function resetSharedCommandCenter(): void {
  sharedCenter = undefined;
}

function permissionOf(task: WorkTask | null): CommandCenterSnapshot['permission'] {
  const waiting = task?.plan.find(step => step.status === 'waiting_permission');
  return {
    waiting: Boolean(waiting),
    taskId: task?.id,
    stepId: waiting?.id,
    capability: waiting?.pendingConfirmation?.capability || waiting?.capability,
    proposalId: waiting?.pendingConfirmation?.proposalId,
  };
}

import { WorkAgent, WorkTaskStore, newStepId, type PlanStep, type WorkStepInvoker, type WorkTask } from '../agent';
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
  SkillVersionRegistry,
  buildEvolutionGraph,
  buildJournal,
  createCandidateSandbox,
  reflectStructured,
  type EvolutionGraph,
  type JarvisJournal,
  type NightCycleReport,
} from '../evolution';
import { ProactiveMonitor, type MonitorSignal } from '../monitor';
import { visualStateFromEvents } from '../ops/visualState';
import type { JarvisVisualState } from '../ops/types';
import { sharedJarvisEventBus, type JarvisEventBus } from '../security/eventBus';
import { SimulatedScreenCapture, SimulatedVisionAnalyzer, type VisualContext } from '../vision';
import type { JarvisOperationEvent } from '../security/types';
import { presentCommandCenter } from './commandCenterView';

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
  };
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
};

export class CommandCenterRuntime {
  public readonly events: JarvisEventBus;
  public readonly control: OwnerControl;
  public readonly agent: WorkAgent;
  public readonly experiences = new ExperienceStore();
  public readonly claims = new ClaimStore();
  public readonly skills = new SkillVersionRegistry();
  public readonly failures = new FailureLedger();
  public readonly selfModel = new CapabilitySelfModel();
  public readonly growth = new GrowthPlanner();
  public readonly practice = new PracticeEngine();
  public readonly benchmarks = new BenchmarkBank();
  public readonly affect = new AffectEngine();
  public readonly candidates = new CandidateManager();
  public readonly modelAdaptation = new ModelAdaptationRegistry();
  public readonly monitor = new ProactiveMonitor();
  public readonly devices = new SimulatedDeviceProvider();
  public readonly visionCapture = new SimulatedScreenCapture();
  public readonly visionAnalyzer = new SimulatedVisionAnalyzer();
  public readonly night: NightCycle;
  private vision: VisualContext | null = null;
  private notifications: MonitorSignal[] = [];
  private readonly reflections: Array<{ experienceId: string; reusableLesson: string }> = [];

  constructor(options: CommandCenterOptions = {}) {
    const simulated = Boolean(options.simulated);
    this.events = options.events ?? sharedJarvisEventBus();
    this.control = new OwnerControl({
      maxAutonomy: 2,
      currentAutonomy: 1,
      researchDepth: 'standard',
      backgroundEvolution: false,
      nightCycle: false,
      proactiveAlerts: true,
      simulationMode: simulated,
    });
    this.agent = new WorkAgent({
      store: new WorkTaskStore(options.now),
      events: this.events,
      now: options.now,
      invoke: options.invoke,
      simulated,
    });
    this.night = new NightCycle({
      experiences: this.experiences,
      skills: this.skills,
      failures: this.failures,
      selfModel: this.selfModel,
      growth: this.growth,
      events: this.events,
      now: options.now,
      simulated,
    });
  }

  public snapshot(): CommandCenterSnapshot {
    const tasks = this.agent.store.list();
    const active = this.agent.store.active()[0] ?? null;
    const experiences = this.experiences.list();
    return {
      simulationMode: this.control.snapshot().simulationMode,
      visualState: visualStateFromEvents(this.events.recent(12)),
      operations: this.events.recent(40),
      task: active,
      tasks,
      evolution: {
        experiences: experiences.length,
        reflections: this.reflections.length,
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
          reflections: this.reflections,
          skills: this.skills.list().map(item => ({ skillId: item.skillId, version: item.version, purpose: item.purpose })),
          goals: this.growth.list(),
          failures: this.failures.list(),
        }),
        night: this.night.snapshot(),
        affect: this.affect.snapshot(),
        affectStyle: this.affect.style(),
        selfModel: this.selfModel.matrix(),
        candidates: this.candidates.list(),
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
    const experience = this.experiences.createIfSignificant({
      kind: 'episodic',
      domain: 'task',
      goal: task.objective,
      situation: task.objective,
      actions: task.plan.map(step => step.kind),
      tools: task.toolResults.map(item => item.capability),
      result: task.verification?.summary || task.outcome || task.status,
      outcome: task.outcome === 'success' ? 'success' : task.outcome === 'cancelled' ? 'partial' : 'failure',
      lessons: task.outcome === 'success' ? ['Reusable structured plan'] : ['Do not treat failure as success'],
      confidence: task.outcome === 'success' ? 0.8 : 0.55,
      privacyClass: 'private',
      significance: 0.7,
      cause: task.errors[0]?.code,
    });
    if (!experience) return;
    this.events.emit('EXPERIENCE_CREATED', 'Experience recorded', { experienceId: experience.id }, 'info', {
      taskId: task.id,
      simulated: task.simulated,
      visualState: 'LEARNING',
    });
    if (experience.outcome === 'failure') this.failures.record(experience, experience.cause || 'STEP_FAILED');
    const reflection = reflectStructured(
      experience,
      this.experiences.similarFailures(experience.cause || experience.result),
      experience.outcome === 'failure' ? 'important_failure' : 'task_completed',
    );
    this.reflections.push({ experienceId: experience.id, reusableLesson: reflection.reusableLesson });
    this.events.emit('REFLECTION', 'Structured reflection recorded', { experienceId: experience.id }, 'info', {
      simulated: task.simulated,
      visualState: 'REFLECTING',
    });
    if (reflection.skillCandidateAllowed) {
      this.skills.propose({
        skillId: slug(task.objective),
        purpose: task.objective,
        trigger: task.objective,
        prerequisites: [],
        workflow: task.plan.map(step => step.title),
        failureModes: [],
        recovery: [],
        safetyConstraints: ['scriptsAllowed=false', 'no production writes'],
        verification: [task.verification?.summary || 'structured'],
        evidence: [experience.id],
      });
    }
    const cap = task.toolResults[0]?.capability || 'task';
    this.selfModel.observe(cap, experience.outcome === 'success' ? 'success' : 'failure', experience.cause);
    this.affect.appraise({ kind: experience.outcome === 'success' ? 'success' : 'failure' });
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

  public async grantAndResume(taskId: string, stepId?: string) {
    const granted = this.agent.grantPermission(taskId, stepId);
    if (granted.status === 'READY' || granted.status === 'WAITING_PERMISSION' || granted.status === 'PAUSED') {
      const done = await this.agent.resume(taskId);
      if (done.outcome) this.recordTaskExperience(done);
      return done;
    }
    return granted;
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
    const task = this.agent.receive('What is the current official driver policy for the lab GPU?', plan);
    const done = await this.agent.run(task.id);
    this.recordTaskExperience(done);
  }

  private async demoCoding(): Promise<void> {
    const understand = demoStep('understand', 'Understand the bug');
    const search = demoStep('search', 'Search local workspace', [understand.id]);
    const apply = demoStep('apply', 'Apply a simulated patch', [search.id]);
    const test = demoStep('test', 'Run fixture tests', [apply.id]);
    const verify = demoStep('verify', 'Verify the fix', [test.id]);
    const task = this.agent.receive('Fix a simulated voice latency regression', [understand, search, apply, test, verify]);
    const done = await this.agent.run(task.id);
    this.recordTaskExperience(done);
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
    this.reflections.push({ experienceId: failed.id, reusableLesson: reflection.reusableLesson });
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
      severity: 'warning',
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

export type DemoScenarioId = 'research' | 'coding' | 'evolution' | 'monitoring';

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 40) || 'task';
}

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
  sharedCenter ??= new CommandCenterRuntime({ events: sharedJarvisEventBus(), simulated: false });
  return sharedCenter;
}

export function resetSharedCommandCenter(): void {
  sharedCenter = undefined;
}

import type { JarvisEventBus } from '../security/eventBus';
import { mergeBudgets } from '../ops/budgets';
import type { JarvisBudgets, ResourcePriority } from '../ops/types';
import type { ExperienceStore } from './experienceStore';
import { FailureLedger } from './failureLearning';
import { GrowthPlanner } from './growthPlanner';
import { reflectStructured } from './reflectionEngine';
import type { ReflectionLedger } from './reflectionLedger';
import type { CapabilitySelfModel } from './selfModel';
import type { SkillVersionRegistry } from './skillVersions';

export const NIGHT_STAGES = [
  'DIGEST',
  'DEDUPLICATE',
  'CONSOLIDATE',
  'REFLECT',
  'DISTILL_SKILLS',
  'UPDATE_SELF_MODEL',
  'SELECT_GROWTH_GOALS',
  'BENCHMARK',
  'CLEANUP',
] as const;

export type NightStage = (typeof NIGHT_STAGES)[number];

export type NightCycleStatus = 'idle' | 'running' | 'paused' | 'cancelled' | 'completed';

export type NightCycleReport = {
  status: NightCycleStatus;
  stage: NightStage | null;
  experiencesProcessed: number;
  memoriesMerged: number;
  contradictionsResolved: number;
  reflectionsCreated: number;
  skillsProposed: number;
  skillsUpdated: number;
  failuresDetected: number;
  goalsUpdated: number;
  benchmarksRun: number;
  pausedFor?: ResourcePriority;
  simulated?: boolean;
};

export type NightCycleOptions = {
  experiences: ExperienceStore;
  skills?: SkillVersionRegistry;
  failures?: FailureLedger;
  selfModel?: CapabilitySelfModel;
  growth?: GrowthPlanner;
  reflections?: ReflectionLedger;
  persistReport?: (report: NightCycleReport) => void;
  events?: JarvisEventBus;
  budgets?: Partial<JarvisBudgets>;
  now?: () => number;
  simulated?: boolean;
  resource?: () => ResourcePriority;
  runBenchmarks?: () => number;
};

export class NightCycle {
  private status: NightCycleStatus = 'idle';
  private stage: NightStage | null = null;
  private cancelRequested = false;
  private readonly budgets: JarvisBudgets;
  private readonly now: () => number;
  private runStarted = 0;
  private readonly report: NightCycleReport;

  constructor(private readonly options: NightCycleOptions) {
    this.now = options.now ?? (() => Date.now());
    this.budgets = mergeBudgets(options.budgets);
    this.report = emptyReport(options.simulated);
  }

  public snapshot(): NightCycleReport {
    return { ...this.report, status: this.status, stage: this.stage };
  }

  public pause(): NightCycleReport {
    if (this.status === 'running') this.status = 'paused';
    this.report.status = this.status;
    this.report.pausedFor = this.options.resource?.();
    return this.snapshot();
  }

  public resume(): NightCycleReport {
    if (this.status === 'paused') this.status = 'running';
    this.report.pausedFor = undefined;
    this.report.status = this.status;
    return this.snapshot();
  }

  public cancel(): NightCycleReport {
    this.cancelRequested = true;
    this.status = 'cancelled';
    this.report.status = 'cancelled';
    this.options.events?.emit('CANCELLED', 'Night cycle cancelled', {}, 'info', {
      visualState: 'IDLE',
      simulated: this.options.simulated,
    });
    return this.snapshot();
  }

  public run(): NightCycleReport {
    this.cancelRequested = false;
    this.status = 'running';
    this.runStarted = this.now();
    this.options.events?.emit('NIGHT_CYCLE', 'Night consolidation started', {}, 'info', {
      visualState: 'EVOLVING',
      simulated: this.options.simulated,
    });
    for (const stage of NIGHT_STAGES) {
      if (this.cancelRequested) break;
      const pressure = this.options.resource?.() ?? 'background_evolution';
      if (pressure === 'realtime_voice' || pressure === 'owner_task') {
        this.status = 'paused';
        this.report.pausedFor = pressure;
        this.report.status = 'paused';
        this.stage = stage;
        return this.snapshot();
      }
      if (this.now() - this.runStarted > this.budgets.nightCycleRuntimeMs) {
        this.status = 'paused';
        this.report.pausedFor = 'background_evolution';
        this.report.status = 'paused';
        this.stage = stage;
        return this.snapshot();
      }
      this.stage = stage;
      this.step(stage);
    }
    this.status = this.cancelRequested ? 'cancelled' : 'completed';
    this.report.status = this.status;
    this.stage = null;
    const snapshot = this.snapshot();
    this.options.persistReport?.(snapshot);
    return snapshot;
  }

  private step(stage: NightStage): void {
    const experiences = this.options.experiences.list();
    if (stage === 'DIGEST') this.report.experiencesProcessed = experiences.length;
    if (stage === 'DEDUPLICATE') {
      const keys = new Set(experiences.map(item => `${item.goal}|${item.outcome}|${item.cause || ''}`));
      this.report.memoriesMerged = Math.max(0, experiences.length - keys.size);
    }
    if (stage === 'CONSOLIDATE') {
      this.report.contradictionsResolved = experiences.filter(item => item.outcome === 'corrected').length;
    }
    if (stage === 'REFLECT') {
      let count = 0;
      const seen = new Set(this.options.reflections?.list().map(item => `${item.experienceId}:night_consolidation`) ?? []);
      for (const experience of experiences.slice(0, this.budgets.reflectionCount)) {
        const key = `${experience.id}:night_consolidation`;
        const reflection = reflectStructured(experience, this.options.experiences.similarFailures(experience.cause || experience.result), 'night_consolidation');
        if (!seen.has(key)) {
          this.options.reflections?.add(reflection);
          seen.add(key);
        }
        count += 1;
      }
      this.report.reflectionsCreated = count;
    }
    if (stage === 'DISTILL_SKILLS') {
      let proposed = 0;
      const existing = new Set((this.options.skills?.list() ?? []).flatMap(item => item.evidence));
      for (const experience of experiences) {
        if (experience.outcome !== 'success' || experience.confidence < 0.7) continue;
        if (existing.has(experience.id)) continue;
        this.options.skills?.propose({
          skillId: `night_${(experience.domain || 'task').replace(/[^a-z0-9]+/giu, '_').slice(0, 32)}`,
          purpose: experience.goal,
          trigger: experience.situation,
          prerequisites: [],
          workflow: experience.actions,
          failureModes: experience.cause ? [experience.cause] : [],
          recovery: ['Retry with structured verification'],
          safetyConstraints: ['scriptsAllowed=false', 'no production promotion'],
          verification: ['structured_check'],
          evidence: [experience.id],
        });
        existing.add(experience.id);
        proposed += 1;
      }
      this.report.skillsProposed = proposed;
      this.report.skillsUpdated = 0;
    }
    if (stage === 'UPDATE_SELF_MODEL' && this.options.selfModel) {
      const seen = new Map<string, number>();
      for (const experience of experiences) {
        const cap = experience.tools[0] || experience.domain || 'general';
        seen.set(cap, (seen.get(cap) ?? 0) + 1);
        const current = this.options.selfModel.get(cap);
        if (current && current.attempts >= (seen.get(cap) ?? 0)) continue;
        this.options.selfModel.observe(cap, experience.outcome === 'success' ? 'success' : experience.outcome === 'partial' ? 'partial' : 'failure', experience.cause);
      }
    }
    if (stage === 'BENCHMARK') {
      this.report.benchmarksRun = this.options.runBenchmarks?.() ?? 0;
    }
    if (stage === 'SELECT_GROWTH_GOALS' && this.options.growth) {
      for (const fail of this.options.failures?.recurring() ?? []) {
        if (this.options.growth.active().length >= 3) break;
        const id = `goal_${fail.signature.replace(/[^a-z0-9]+/giu, '_').slice(0, 24)}`;
        if (!this.options.growth.list().some(item => item.id === id)) {
          this.options.growth.propose({
            id,
            title: `Reduce ${fail.errorClass} in ${fail.domain || 'general'}`,
            evidence: fail.signature,
            practice: 'Rehearse the failing capability with fixtures',
            metric: 'recurrence_count',
            successCondition: 'No recurrence for 3 similar tasks',
          });
        }
      }
      this.report.goalsUpdated = this.options.growth.active().length;
    }
    if (stage === 'CLEANUP') {
      this.report.failuresDetected = this.options.failures?.recurring().length ?? experiences.filter(item => item.outcome === 'failure').length;
    }
  }
}

function emptyReport(simulated?: boolean): NightCycleReport {
  return {
    status: 'idle',
    stage: null,
    experiencesProcessed: 0,
    memoriesMerged: 0,
    contradictionsResolved: 0,
    reflectionsCreated: 0,
    skillsProposed: 0,
    skillsUpdated: 0,
    failuresDetected: 0,
    goalsUpdated: 0,
    benchmarksRun: 0,
    simulated,
  };
}

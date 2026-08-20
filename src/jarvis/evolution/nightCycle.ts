import type { JarvisEventBus } from '../security/eventBus';
import { mergeBudgets } from '../ops/budgets';
import type { JarvisBudgets, ResourcePriority } from '../ops/types';
import type { ExperienceStore } from './experienceStore';
import { FailureLedger } from './failureLearning';
import { GrowthPlanner } from './growthPlanner';
import { reflectStructured } from './reflectionEngine';
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
  events?: JarvisEventBus;
  budgets?: Partial<JarvisBudgets>;
  now?: () => number;
  simulated?: boolean;
  resource?: () => ResourcePriority;
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
    return this.snapshot();
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
      for (const experience of experiences.slice(0, this.budgets.reflectionCount)) {
        reflectStructured(experience, this.options.experiences.similarFailures(experience.cause || experience.result), 'night_consolidation');
        count += 1;
      }
      this.report.reflectionsCreated = count;
    }
    if (stage === 'DISTILL_SKILLS') {
      this.report.skillsProposed = experiences.filter(item => item.outcome === 'success' && item.confidence >= 0.7).length;
      this.report.skillsUpdated = 0;
    }
    if (stage === 'UPDATE_SELF_MODEL' && this.options.selfModel) {
      for (const experience of experiences) {
        const cap = experience.tools[0] || experience.domain || 'general';
        this.options.selfModel.observe(cap, experience.outcome === 'success' ? 'success' : experience.outcome === 'partial' ? 'partial' : 'failure', experience.cause);
      }
    }
    if (stage === 'SELECT_GROWTH_GOALS' && this.options.growth) {
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

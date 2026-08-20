import type { WorkTask } from '../agent/types';
import type { JarvisEventBus } from '../security/eventBus';
import type { JarvisMemoryStore } from '../../bot/memory/jarvis/store';
import type { SemanticCandidate } from '../../bot/memory/jarvis/types';
import { writeExperienceEpisode } from '../memory/experienceBridge';
import type { AffectEngine } from './affect';
import type { BenchmarkBank } from './benchmarks';
import type { ExperienceStore } from './experienceStore';
import type { FailureLedger, FailureRecord } from './failureLearning';
import type { GrowthPlanner } from './growthPlanner';
import { verifyTaskOutcome } from './outcomeVerification';
import { reflectStructured, type ReflectionRecord } from './reflectionEngine';
import type { ReflectionLedger } from './reflectionLedger';
import { runIsolatedSkillBenchmark, type IsolatedSkillBenchmark } from './skillBenchmark';
import { buildSkillCandidateFromExperience } from './skillCandidate';
import type { CapabilitySelfModel } from './selfModel';
import type { SkillVersionRegistry } from './skillVersions';
import type { ExperienceRecord, ProceduralSkillVersion } from './types';

export type EvolutionLifecycleStores = {
  experiences: ExperienceStore;
  reflections: ReflectionLedger;
  failures: FailureLedger;
  skills: SkillVersionRegistry;
  selfModel: CapabilitySelfModel;
  growth?: GrowthPlanner;
  affect?: AffectEngine;
  events?: JarvisEventBus;
  memoryStore?: JarvisMemoryStore;
  benchmarks?: BenchmarkBank;
};

export type EvolutionLifecycleResult = {
  experience: ExperienceRecord | null;
  reflection: ReflectionRecord | null;
  duplicate?: boolean;
  verified: boolean;
  classification: ExperienceRecord['outcome'] | 'skipped';
  memoryCandidate?: SemanticCandidate | null;
  skillCandidate?: ProceduralSkillVersion | null;
  benchmarkCandidate?: IsolatedSkillBenchmark | null;
  failureKnowledge?: FailureRecord | null;
};

export function applyTaskOutcome(task: WorkTask, stores: EvolutionLifecycleStores): EvolutionLifecycleResult {
  return runExperiencePipeline(task, stores);
}

export function runExperiencePipeline(task: WorkTask, stores: EvolutionLifecycleStores): EvolutionLifecycleResult {
  const experienceId = `exp_task_${task.id}`;
  const existing = stores.experiences.get(experienceId);
  if (existing) {
    const reflection = stores.reflections.find(existing.id, 'task_completed')
      ?? stores.reflections.list().find(item => item.experienceId === existing.id)
      ?? null;
    const skillCandidate = stores.skills.list().find(item => item.evidence.includes(existing.id)) ?? null;
    return {
      experience: existing,
      reflection,
      duplicate: true,
      verified: existing.verified !== false && existing.outcome === 'success',
      classification: existing.outcome,
      skillCandidate,
      benchmarkCandidate: null,
      failureKnowledge: existing.outcome === 'failure'
        ? stores.failures.list().find(item => item.tool === existing.tools[0]) ?? null
        : null,
    };
  }

  const verified = verifyTaskOutcome(task);
  const experience = stores.experiences.createIfSignificant({
    id: experienceId,
    kind: 'episodic',
    domain: 'task',
    goal: task.objective,
    situation: task.objective,
    actions: task.plan.map(step => step.kind),
    tools: task.toolResults.map(item => item.capability),
    result: verified.summary,
    outcome: verified.outcome,
    lessons: verified.outcome === 'success' ? ['Reusable structured plan'] : ['Do not treat failure as success'],
    confidence: verified.outcome === 'success' && verified.verified ? 0.8 : 0.55,
    privacyClass: 'private',
    significance: 0.7,
    cause: verified.cause,
    evidenceRefs: task.evidence.slice(0, 8),
    verified: verified.verified,
    failureKind: verified.failureKind,
  });
  if (!experience) {
    return {
      experience: null,
      reflection: null,
      verified: false,
      classification: 'skipped',
    };
  }

  stores.events?.emit('EXPERIENCE_CREATED', 'Experience recorded', { experienceId: experience.id }, 'info', {
    taskId: task.id,
    simulated: task.simulated,
    visualState: 'LEARNING',
  });

  let failureKnowledge: FailureRecord | null = null;
  if (experience.outcome === 'failure') {
    failureKnowledge = stores.failures.record(experience, experience.cause || 'STEP_FAILED');
  }

  const reflection = reflectStructured(
    experience,
    stores.experiences.similarFailures(experience.cause || experience.result),
    experience.outcome === 'failure' ? 'important_failure' : 'task_completed',
  );
  stores.reflections.add(reflection);
  stores.events?.emit('REFLECTION', 'Structured reflection recorded', { experienceId: experience.id }, 'info', {
    simulated: task.simulated,
    visualState: 'REFLECTING',
  });

  let memoryCandidate: SemanticCandidate | null | undefined;
  if (stores.memoryStore) {
    const episode = writeExperienceEpisode(stores.memoryStore, experience, task);
    memoryCandidate = stores.memoryStore.listCandidates({ episodeId: episode.id })[0] ?? null;
  }

  let skillCandidate: ProceduralSkillVersion | null = null;
  let benchmarkCandidate: IsolatedSkillBenchmark | null = null;
  if (reflection.skillCandidateAllowed && experience.outcome === 'success' && verified.verified) {
    const proposed = buildSkillCandidateFromExperience(experience, task);
    if (proposed) {
      skillCandidate = stores.skills.propose(proposed);
      if (skillCandidate.trustStatus === 'DRAFT') {
        benchmarkCandidate = runIsolatedSkillBenchmark(stores.skills, skillCandidate, stores.benchmarks);
        skillCandidate = stores.skills.get(skillCandidate.skillId, skillCandidate.version) ?? skillCandidate;
      }
    }
  }

  const cap = task.toolResults[0]?.capability || 'task';
  stores.selfModel.observe(cap, experience.outcome === 'success' ? 'success' : experience.outcome === 'partial' ? 'partial' : 'failure', experience.cause);
  stores.affect?.appraise({ kind: experience.outcome === 'success' ? 'success' : 'failure' });
  if (experience.outcome === 'failure' && stores.growth && stores.growth.active().length < 3) {
    const id = `goal_${(experience.cause || 'step').toLowerCase().replace(/[^a-z0-9]+/gu, '_').slice(0, 24)}`;
    if (!stores.growth.list().some(item => item.id === id)) {
      stores.growth.propose({
        id,
        title: `Reduce ${experience.cause || 'task'} failures`,
        evidence: experience.id,
        practice: 'Rehearse the failing capability with fixtures',
        metric: 'recurrence_count',
        successCondition: 'Three similar tasks complete without this failure',
      });
    }
  }
  return {
    experience,
    reflection,
    verified: verified.verified,
    classification: experience.outcome,
    memoryCandidate,
    skillCandidate,
    benchmarkCandidate,
    failureKnowledge,
  };
}

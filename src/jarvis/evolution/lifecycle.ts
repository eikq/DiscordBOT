import type { WorkTask } from '../agent/types';
import type { JarvisEventBus } from '../security/eventBus';
import type { AffectEngine } from './affect';
import type { ExperienceStore } from './experienceStore';
import type { FailureLedger } from './failureLearning';
import type { GrowthPlanner } from './growthPlanner';
import { reflectStructured, type ReflectionRecord } from './reflectionEngine';
import type { ReflectionLedger } from './reflectionLedger';
import type { CapabilitySelfModel } from './selfModel';
import type { SkillVersionRegistry } from './skillVersions';
import type { ExperienceRecord } from './types';

export type EvolutionLifecycleStores = {
  experiences: ExperienceStore;
  reflections: ReflectionLedger;
  failures: FailureLedger;
  skills: SkillVersionRegistry;
  selfModel: CapabilitySelfModel;
  growth?: GrowthPlanner;
  affect?: AffectEngine;
  events?: JarvisEventBus;
};

export type EvolutionLifecycleResult = {
  experience: ExperienceRecord | null;
  reflection: ReflectionRecord | null;
};

export function applyTaskOutcome(task: WorkTask, stores: EvolutionLifecycleStores): EvolutionLifecycleResult {
  const outcome = task.outcome === 'success'
    ? 'success'
    : task.outcome === 'cancelled'
      ? 'partial'
      : 'failure';
  const experience = stores.experiences.createIfSignificant({
    kind: 'episodic',
    domain: 'task',
    goal: task.objective,
    situation: task.objective,
    actions: task.plan.map(step => step.kind),
    tools: task.toolResults.map(item => item.capability),
    result: task.verification?.summary || task.outcome || task.status,
    outcome,
    lessons: outcome === 'success' ? ['Reusable structured plan'] : ['Do not treat failure as success'],
    confidence: outcome === 'success' ? 0.8 : 0.55,
    privacyClass: 'private',
    significance: 0.7,
    cause: task.errors[0]?.code,
    evidenceRefs: task.evidence.slice(0, 8),
  });
  if (!experience) return { experience: null, reflection: null };

  stores.events?.emit('EXPERIENCE_CREATED', 'Experience recorded', { experienceId: experience.id }, 'info', {
    taskId: task.id,
    simulated: task.simulated,
    visualState: 'LEARNING',
  });

  if (experience.outcome === 'failure') {
    stores.failures.record(experience, experience.cause || 'STEP_FAILED');
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

  if (reflection.skillCandidateAllowed && experience.outcome === 'success') {
    stores.skills.propose({
      skillId: slug(task.objective),
      purpose: task.objective,
      trigger: task.objective,
      prerequisites: [],
      workflow: task.plan.map(step => step.title),
      failureModes: task.errors.map(item => item.code),
      recovery: ['Retry with structured verification'],
      safetyConstraints: ['scriptsAllowed=false', 'no production writes', 'no auto-promote'],
      verification: [task.verification?.summary || 'structured_check'],
      evidence: [experience.id],
    });
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
  return { experience, reflection };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 40) || 'task';
}

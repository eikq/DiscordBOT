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
  duplicate?: boolean;
};

export function applyTaskOutcome(task: WorkTask, stores: EvolutionLifecycleStores): EvolutionLifecycleResult {
  const experienceId = `exp_task_${task.id}`;
  const existing = stores.experiences.get(experienceId);
  if (existing) {
    const reflection = stores.reflections.list().find(item => item.experienceId === existing.id) ?? null;
    return { experience: existing, reflection, duplicate: true };
  }
  const outcome = task.outcome === 'success'
    ? 'success'
    : task.outcome === 'cancelled' || task.outcome === 'degraded'
      ? 'partial'
      : 'failure';
  const blocker = task.blockers?.[0];
  const verificationState = task.verification?.state;
  const verifiedSuccess = outcome === 'success' && verificationState === 'VERIFIED';
  const experience = stores.experiences.createIfSignificant({
    id: experienceId,
    kind: 'episodic',
    domain: task.goalResolution?.goalId ?? 'task',
    ...(task.goalResolution?.goalId ? { goalId: task.goalResolution.goalId } : {}),
    ...(task.goalOutcome ? { goalOutcome: task.goalOutcome } : {}),
    goal: task.objective,
    situation: task.objective,
    actions: task.plan.map(step => step.kind),
    tools: task.toolResults.map(item => item.capability),
    result: task.verification?.summary || task.outcome || task.status,
    outcome,
    lessons: verifiedSuccess
      ? ['Reusable structured plan with independently verified outcome']
      : outcome === 'success'
        ? ['Execution completed, but competence remains unverified']
        : ['Do not treat failure as success'],
    confidence: verifiedSuccess ? 0.8 : outcome === 'success' ? 0.45 : 0.55,
    privacyClass: 'private',
    significance: 0.7,
    cause: task.errors[0]?.code,
    evidenceRefs: unique([
      ...(task.goalResolution?.goalId ? [`goal:${task.goalResolution.goalId}`] : []),
      ...(task.goalResolution?.evidence ?? []).slice(0, 4),
      ...task.evidence.slice(0, 8),
    ]),
    verificationState,
    ...(blocker ? {
      failureAnalysis: {
        capability: blocker.capabilityId,
        blocker: blocker.blocker,
        stage: task.plan.find(step => step.status === 'failed' || step.status === 'blocked')?.kind,
        nextPossibleStep: task.gapResolution?.recommendedPath?.title,
      },
    } : {}),
  });
  if (!experience) return { experience: null, reflection: null };

  stores.events?.emit('EXPERIENCE_CREATED', 'Experience recorded', { experienceId: experience.id }, 'info', {
    taskId: task.id,
    simulated: task.simulated,
    visualState: 'LEARNING',
  });

  if (experience.outcome === 'failure') {
    stores.failures.record(experience, experience.cause || 'STEP_FAILED', {
      blocker: blocker?.blocker,
      nextPossibleStep: task.gapResolution?.recommendedPath?.title,
    });
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

  if (reflection.skillCandidateAllowed && experience.outcome === 'success' && verificationState === 'VERIFIED') {
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

  const capabilityResults = task.toolResults.length
    ? task.toolResults
    : [{ capability: 'task', status: experience.outcome, summary: experience.result }];
  for (const [index, result] of capabilityResults.entries()) {
    const capabilityOutcome = result.status === 'ok'
      ? (experience.outcome === 'success' ? 'success' : 'partial')
      : 'failure';
    stores.selfModel.observe(
      result.capability,
      capabilityOutcome,
      capabilityOutcome === 'failure' ? blocker?.blocker || result.status || experience.cause : undefined,
      {
        verificationState: capabilityOutcome === 'success' ? verificationState : 'FAILED_VERIFICATION',
        evidenceRefs: unique([`task:${task.id}`, ...task.evidence.slice(0, 8)]),
        observationId: `${experience.id}:capability:${index}:${result.capability}`,
      },
    );
  }
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

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 40) || 'task';
}

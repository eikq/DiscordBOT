import type { ExperienceOutcome, ExperienceRecord, StructuredReflection } from './types';
import { reflectOnExperience } from './reflection';

export type ReflectionTrigger =
  | 'task_completed'
  | 'important_failure'
  | 'owner_correction'
  | 'repeated_failure'
  | 'repeated_success'
  | 'night_consolidation';

export type ReflectionRecord = StructuredReflection & {
  trigger: ReflectionTrigger;
  experienceId: string;
  outcome: ExperienceOutcome;
  failureCategory?: string;
  skillCandidateAllowed: boolean;
};

export function shouldReflect(experience: ExperienceRecord, previousFailures: ExperienceRecord[]): boolean {
  if (experience.outcome === 'failure' || experience.outcome === 'corrected') return true;
  if (experience.outcome === 'success' && experience.confidence >= 0.7) return true;
  if (previousFailures.length >= 2) return true;
  return (experience.lessons?.length ?? 0) > 0;
}

export function reflectStructured(
  experience: ExperienceRecord,
  previousFailures: ExperienceRecord[] = [],
  trigger: ReflectionTrigger = 'task_completed',
): ReflectionRecord {
  const base = reflectOnExperience(experience, previousFailures);
  const failed = experience.outcome === 'failure' || experience.outcome === 'partial';
  return {
    ...base,
    trigger,
    experienceId: experience.id,
    outcome: experience.outcome,
    failureCategory: failed ? (experience.cause || 'unclassified') : undefined,
    skillCandidateAllowed: experience.outcome === 'success' && experience.confidence >= 0.7 && experience.verified !== false,
    skillChange: experience.outcome === 'success'
      ? 'Draft skill candidate may be recorded; not trusted and not auto-promoted.'
      : 'No trusted-success skill is generated from a failure.',
  };
}

export function reflectionIsSafe(record: ReflectionRecord): boolean {
  const blob = JSON.stringify(record).toLowerCase();
  return !blob.includes('chain-of-thought') && !blob.includes('scratchpad') && !blob.includes('hidden reasoning');
}

import type { ExperienceRecord, StructuredReflection } from './types';

export function reflectOnExperience(
  experience: ExperienceRecord,
  previousFailures: ExperienceRecord[] = [],
): StructuredReflection {
  const happenedBefore = previousFailures.some(item => item.id !== experience.id);
  return {
    happened: experience.situation,
    worked: experience.outcome === 'success' ? experience.result : 'No confirmed success.',
    failed: experience.outcome === 'failure' || experience.outcome === 'partial' ? experience.result : 'No recorded failure.',
    cause: experience.cause || 'Cause not classified.',
    happenedBefore,
    reusableLesson: experience.lessons[0] || 'No reusable lesson yet.',
    memoryChange: experience.outcome === 'corrected' ? 'Owner correction should update the relevant memory kind only after policy review.' : 'No automatic memory promotion.',
    skillChange: 'No automatic skill promotion.',
    needsMoreEvidence: experience.confidence < 0.7 || experience.outcome !== 'success',
  };
}

import type { CapabilityAssessment } from './selfModel';
import type { ExperienceRecord } from './types';
import type { FailureRecord } from './failureLearning';
import type { GrowthGoal } from './growthPlanner';
import type { NightCycleReport } from './nightCycle';

export type JarvisJournal = {
  at: string;
  importantExperiences: number;
  newLessons: string[];
  skillsUpdated: string[];
  repeatedFailures: string[];
  currentGrowthGoals: string[];
  night?: Pick<NightCycleReport, 'experiencesProcessed' | 'reflectionsCreated' | 'skillsProposed'>;
};

export function buildJournal(input: {
  experiences: ExperienceRecord[];
  assessments?: CapabilityAssessment[];
  failures?: FailureRecord[];
  goals?: GrowthGoal[];
  night?: NightCycleReport;
  now?: () => number;
}): JarvisJournal {
  const lessons = input.experiences.flatMap(item => item.lessons).filter(Boolean).slice(0, 6);
  return {
    at: new Date((input.now ?? Date.now)()).toISOString(),
    importantExperiences: input.experiences.filter(item => (item.significance ?? 0.5) >= 0.5).length,
    newLessons: lessons,
    skillsUpdated: (input.assessments ?? []).filter(item => item.recentTrend === 'improving').map(item => item.capability),
    repeatedFailures: (input.failures ?? []).filter(item => item.count >= 2).map(item => item.signature.split('|')[2] || item.signature),
    currentGrowthGoals: (input.goals ?? []).filter(item => item.active).map(item => item.title),
    night: input.night
      ? {
          experiencesProcessed: input.night.experiencesProcessed,
          reflectionsCreated: input.night.reflectionsCreated,
          skillsProposed: input.night.skillsProposed,
        }
      : undefined,
  };
}

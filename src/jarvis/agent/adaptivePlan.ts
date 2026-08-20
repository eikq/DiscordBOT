import type { FailureLedger } from '../evolution/failureLearning';
import type { ProceduralSkillVersion } from '../evolution/types';
import { isAutoSelectableSkill } from '../evolution/skillTrust';
import type { PlanStep } from './types';

export function adaptPlanForFailures(
  plan: PlanStep[],
  ledger?: FailureLedger,
  skills: ProceduralSkillVersion[] = [],
): PlanStep[] {
  const trustedOnly = skills.filter(isAutoSelectableSkill);
  if (!ledger) return annotateTrustedSkills(plan, trustedOnly);
  const recurring = ledger.recurring(2);
  if (recurring.length === 0) return annotateTrustedSkills(plan, trustedOnly);
  const adapted = plan.map(step => {
    const hit = recurring.find(item => item.tool && item.tool === step.capability);
    if (!hit) return step;
    return {
      ...step,
      retryPolicy: {
        ...step.retryPolicy,
        maxAttempts: Math.min(step.retryPolicy.maxAttempts, 1),
      },
      title: `${step.title} (known ${hit.errorClass}; ${hit.kind}; extra verify)`,
    };
  });
  return annotateTrustedSkills(adapted, trustedOnly);
}

function annotateTrustedSkills(plan: PlanStep[], skills: ProceduralSkillVersion[]): PlanStep[] {
  if (skills.length === 0) return plan;
  return plan.map(step => {
    if (step.kind !== 'verify') return step;
    const hint = skills[0]?.verification[0];
    if (!hint) return step;
    return {
      ...step,
      verificationMethod: step.verificationMethod,
      title: `${step.title} (trusted skill check)`,
    };
  });
}

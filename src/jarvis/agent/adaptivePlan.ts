import type { FailureLedger } from '../evolution/failureLearning';
import type { ProceduralSkillVersion } from '../evolution/types';
import type { PlanStep } from './types';

export function adaptPlanForFailures(
  plan: PlanStep[],
  ledger?: FailureLedger,
  skills: ProceduralSkillVersion[] = [],
): PlanStep[] {
  if (!ledger) return annotateTrustedSkills(plan, skills);
  const recurring = ledger.recurring(2);
  if (recurring.length === 0) return annotateTrustedSkills(plan, skills);
  const adapted = plan.map(step => {
    const hit = recurring.find(item => item.tool && item.tool === step.capability);
    if (!hit) return step;
    return {
      ...step,
      retryPolicy: {
        ...step.retryPolicy,
        maxAttempts: Math.min(step.retryPolicy.maxAttempts, 1),
      },
      title: `${step.title} (known ${hit.errorClass}; extra verify)`,
    };
  });
  return annotateTrustedSkills(adapted, skills);
}

function annotateTrustedSkills(plan: PlanStep[], skills: ProceduralSkillVersion[]): PlanStep[] {
  const trusted = skills.filter(skill => (
    skill.knownGood
    || skill.status === 'ACTIVE'
    || skill.status === 'TRUSTED_INSTRUCTION'
  ));
  if (trusted.length === 0) return plan;
  return plan.map(step => {
    if (step.kind !== 'verify') return step;
    const hint = trusted[0]?.verification[0];
    if (!hint) return step;
    return {
      ...step,
      verificationMethod: step.verificationMethod,
      title: `${step.title} (trusted skill check)`,
    };
  });
}

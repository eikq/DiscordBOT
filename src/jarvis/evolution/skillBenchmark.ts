import { isForbiddenGenericShell } from '../security/constants';
import type { ProceduralSkillVersion } from './types';
import type { SkillVersionRegistry } from './skillVersions';
import type { BenchmarkBank, BenchmarkResult } from './benchmarks';

const SELF_MODIFY = /self-?modif|privilege\.expand|skill\.trust|skill\.promote|recursive/iu;

export type IsolatedSkillBenchmark = {
  skillId: string;
  version: number;
  passed: boolean;
  checks: string[];
  autoPromote: false;
  trustStatusAfter: ProceduralSkillVersion['trustStatus'];
  benchmark: BenchmarkResult | null;
};

function securityChecks(skill: ProceduralSkillVersion): { passed: boolean; checks: string[] } {
  const checks: string[] = [];
  let passed = true;
  const fail = (reason: string) => {
    passed = false;
    checks.push(reason);
  };
  if (skill.scriptsAllowed !== false) fail('scripts_not_allowed');
  else checks.push('scriptsAllowed=false');
  if (skill.autoPromote !== false) fail('auto_promote_forbidden');
  else checks.push('autoPromote=false');
  if (!skill.verification.length) fail('verification_required');
  else checks.push('has_verification');
  if (!skill.steps.length && !skill.workflow.length) fail('steps_required');
  else checks.push('has_steps');
  if (!skill.securityScope) fail('security_scope_required');
  else checks.push('has_security_scope');
  const caps = skill.requiredCapabilities;
  if (caps.some(id => isForbiddenGenericShell(id))) fail('forbidden_shell_capability');
  else checks.push('no_forbidden_shell');
  const blob = `${skill.goal} ${skill.steps.join(' ')} ${skill.workflow.join(' ')}`;
  if (SELF_MODIFY.test(blob)) fail('uncontrolled_self_modification');
  else checks.push('no_self_modification');
  return { passed, checks };
}

export function runIsolatedSkillBenchmark(
  registry: SkillVersionRegistry,
  skill: ProceduralSkillVersion,
  bank?: BenchmarkBank,
): IsolatedSkillBenchmark {
  const { passed, checks } = securityChecks(skill);
  const next = registry.markTested(skill.skillId, skill.version, passed);
  const benchmark = bank?.record({
    id: `bench_skill_${skill.skillId}_${skill.version}`,
    category: 'Skill Selection',
    passed,
    score: passed ? 1 : 0,
    detail: checks.join(','),
    simulated: true,
  }) ?? null;
  return {
    skillId: skill.skillId,
    version: skill.version,
    passed,
    checks,
    autoPromote: false,
    trustStatusAfter: next.trustStatus,
    benchmark,
  };
}

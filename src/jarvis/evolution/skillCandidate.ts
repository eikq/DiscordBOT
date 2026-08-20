import { isForbiddenGenericShell } from '../security/constants';
import type { WorkTask } from '../agent/types';
import type { ExperienceRecord } from './types';
import type { ProposeSkillInput } from './skillNormalize';

const SELF_MODIFY = /self-?modif|privilege\.expand|skill\.trust|skill\.promote|autoPromote|approve myself/iu;

export function slugSkillId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '').slice(0, 40) || 'task';
}

export function skillCandidateAllowedForExperience(experience: ExperienceRecord): boolean {
  return experience.outcome === 'success'
    && experience.confidence >= 0.7
    && experience.verified !== false;
}

export function buildSkillCandidateFromExperience(
  experience: ExperienceRecord,
  task?: WorkTask,
): ProposeSkillInput | null {
  if (!skillCandidateAllowedForExperience(experience)) return null;
  const workflow = task?.plan.map(step => step.title).filter(Boolean) ?? experience.actions;
  const capabilities = [
    ...new Set([
      ...(task?.toolResults.map(item => item.capability) ?? []),
      ...experience.tools,
    ]),
  ].filter(id => id && !isForbiddenGenericShell(id));
  const goal = task?.objective || experience.goal;
  if (SELF_MODIFY.test([goal, ...workflow].join(' '))) return null;
  return {
    skillId: slugSkillId(goal),
    name: slugSkillId(goal),
    purpose: goal,
    goal,
    trigger: experience.situation || goal,
    triggerConditions: [experience.situation || goal],
    requiredCapabilities: capabilities,
    prerequisites: [],
    workflow,
    steps: workflow,
    failureModes: [
      ...(task?.errors.map(item => item.code) ?? []),
      ...(experience.cause ? [experience.cause] : []),
    ],
    recovery: ['Retry with structured verification; do not expand privileges'],
    safetyConstraints: [
      'scriptsAllowed=false',
      'no production writes',
      'no auto-promote',
      'DISCOVER!=INSTALL!=REVIEW!=TRUST!=EXECUTE',
    ],
    securityScope: 'instruction-only plan; CapabilityHost/ActionGate remain authority',
    verification: [task?.verification?.summary || experience.result || 'structured_check'],
    evidence: [experience.id, ...(experience.evidenceRefs ?? [])].slice(0, 12),
    trustStatus: 'DRAFT',
    status: 'CANDIDATE',
  };
}

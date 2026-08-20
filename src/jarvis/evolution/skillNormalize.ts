import type { ProceduralSkillVersion, SkillLifecycleStatus, SkillTrustStatus } from './types';

export type ProposeSkillInput = {
  skillId: string;
  purpose: string;
  trigger: string;
  prerequisites?: string[];
  workflow?: string[];
  failureModes?: string[];
  recovery?: string[];
  safetyConstraints?: string[];
  verification?: string[];
  evidence?: string[];
  status?: SkillLifecycleStatus;
  trustStatus?: SkillTrustStatus;
  parentVersion?: number;
  name?: string;
  goal?: string;
  triggerConditions?: string[];
  requiredCapabilities?: string[];
  steps?: string[];
  securityScope?: string;
};

export function skillRecordId(skillId: string, version: number): string {
  return `${skillId}@${version}`;
}

export function inferTrustStatus(
  status: SkillLifecycleStatus | undefined,
  trustStatus?: SkillTrustStatus,
  knownGood?: boolean,
): SkillTrustStatus {
  if (trustStatus) return trustStatus;
  if (status === 'REJECTED') return 'REJECTED';
  if (status === 'DEPRECATED' || status === 'ROLLED_BACK') return 'DEPRECATED';
  if (status === 'TRUSTED_INSTRUCTION') return 'TRUSTED';
  if (status === 'TESTED' || (status === 'ACTIVE' && knownGood)) return 'REVIEW_REQUIRED';
  return 'DRAFT';
}

export function normalizeSkill(input: ProposeSkillInput & {
  version: number;
  knownGood: boolean;
  scriptsAllowed?: false;
}): ProceduralSkillVersion {
  const workflow = input.workflow ?? input.steps ?? [];
  const steps = input.steps ?? workflow;
  const prerequisites = input.prerequisites ?? [];
  const purpose = input.purpose;
  const goal = input.goal ?? purpose;
  const status = input.status ?? 'CANDIDATE';
  const knownGood = input.knownGood;
  return {
    id: skillRecordId(input.skillId, input.version),
    skillId: input.skillId,
    name: input.name ?? input.skillId,
    version: input.version,
    purpose,
    goal,
    trigger: input.trigger,
    triggerConditions: input.triggerConditions ?? (input.trigger ? [input.trigger] : []),
    requiredCapabilities: input.requiredCapabilities ?? [],
    prerequisites,
    workflow,
    steps,
    failureModes: input.failureModes ?? [],
    recovery: input.recovery ?? [],
    safetyConstraints: input.safetyConstraints ?? ['scriptsAllowed=false', 'no auto-promote'],
    securityScope: input.securityScope
      ?? (input.safetyConstraints?.join('; ') || 'instruction-only; CapabilityHost remains authority'),
    verification: input.verification ?? [],
    evidence: input.evidence ?? [],
    knownGood,
    status,
    trustStatus: inferTrustStatus(status, input.trustStatus, knownGood),
    parentVersion: input.parentVersion,
    scriptsAllowed: false,
    autoPromote: false,
  };
}

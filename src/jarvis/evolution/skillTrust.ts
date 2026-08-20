import type { PrivilegeActor } from '../security/types';
import type { ProceduralSkillVersion, SkillTrustStatus } from './types';
import { SKILL_AUTHORITY_STAGES, SKILL_TRUST_STATES } from './skillLifecycleConstants';

export { SKILL_AUTHORITY_STAGES, SKILL_TRUST_STATES };

export function autoPromoteSkill(): false {
  return false;
}

export function productionSkillPromotionAllowed(): false {
  return false;
}

export function jarvisMaySelfApproveSkill(): false {
  return false;
}

export function isAutoSelectableSkill(skill: ProceduralSkillVersion): boolean {
  return skill.trustStatus === 'TRUSTED'
    && skill.status !== 'REJECTED'
    && skill.status !== 'DEPRECATED'
    && skill.status !== 'ROLLED_BACK'
    && skill.scriptsAllowed === false
    && skill.autoPromote === false;
}

export function assertOwnerSkillTrust(actor: PrivilegeActor): void {
  if (actor !== 'owner') {
    throw Object.assign(
      new Error('Jarvis may never approve its own privilege expansion.'),
      { reasonCode: 'NO_SELF_APPROVAL' },
    );
  }
}

export function canTransitionTrust(
  from: SkillTrustStatus,
  to: SkillTrustStatus,
  actor: PrivilegeActor,
): boolean {
  if (from === to) return true;
  if (to === 'TRUSTED') return actor === 'owner' && from === 'REVIEW_REQUIRED';
  if (to === 'REVIEW_REQUIRED') return from === 'DRAFT' || from === 'REVIEW_REQUIRED';
  if (to === 'REJECTED' || to === 'DEPRECATED') return from !== 'REJECTED';
  if (to === 'DRAFT') return false;
  return false;
}

export function skillInstructionsAreNotAuthority(): true {
  return true;
}

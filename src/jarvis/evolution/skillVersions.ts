import type { PrivilegeActor } from '../security/types';
import type { JsonCollection } from './persistTypes';
import type { ProceduralSkillVersion } from './types';
import { normalizeSkill, skillRecordId, type ProposeSkillInput } from './skillNormalize';
import { retrieveRelevantSkills } from './skillRetrieval';
import {
  assertOwnerSkillTrust,
  autoPromoteSkill,
  canTransitionTrust,
  isAutoSelectableSkill,
  jarvisMaySelfApproveSkill,
  productionSkillPromotionAllowed,
} from './skillTrust';

export class SkillVersionRegistry {
  private readonly versions = new Map<string, ProceduralSkillVersion[]>();
  private readonly knownGood = new Map<string, number>();

  constructor(private readonly persist?: JsonCollection<ProceduralSkillVersion>) {
    for (const raw of persist?.load() ?? []) {
      const skill = normalizeSkill({
        ...raw,
        version: raw.version,
        knownGood: raw.knownGood,
        scriptsAllowed: false,
      });
      const existing = this.versions.get(skill.skillId) ?? [];
      this.versions.set(skill.skillId, [...existing, skill]);
      if (skill.knownGood) this.knownGood.set(skill.skillId, skill.version);
    }
  }

  public propose(skill: ProposeSkillInput): ProceduralSkillVersion {
    const existing = this.versions.get(skill.skillId) ?? [];
    const evidence = skill.evidence ?? [];
    const duplicate = [...existing].reverse().find(item => (
      item.trustStatus !== 'REJECTED'
      && item.trustStatus !== 'DEPRECATED'
      && evidence.some(id => item.evidence.includes(id))
    ));
    if (duplicate) return { ...duplicate };

    const next = normalizeSkill({
      ...skill,
      version: (existing.at(-1)?.version ?? 0) + 1,
      knownGood: false,
      status: 'CANDIDATE',
      trustStatus: 'DRAFT',
      scriptsAllowed: false,
      parentVersion: skill.parentVersion ?? existing.at(-1)?.version,
    });
    this.versions.set(skill.skillId, [...existing, next]);
    this.flush();
    return { ...next };
  }

  public markTested(skillId: string, version: number, passed: boolean): ProceduralSkillVersion {
    const skill = this.require(skillId, version);
    if (skill.trustStatus === 'TRUSTED') return { ...skill };
    if (passed) {
      skill.status = 'TESTED';
      skill.trustStatus = 'REVIEW_REQUIRED';
    } else {
      skill.status = 'REJECTED';
      skill.trustStatus = 'REJECTED';
    }
    this.flush();
    return { ...skill };
  }

  public reject(skillId: string, version: number, reason: string): ProceduralSkillVersion {
    const skill = this.require(skillId, version);
    if (skill.knownGood) {
      throw Object.assign(new Error('Cannot reject the only known-good skill without rollback.'), { reasonCode: 'CANDIDATE_REJECTED' });
    }
    skill.status = 'REJECTED';
    skill.trustStatus = 'REJECTED';
    skill.evidence = [...skill.evidence, `rejected:${reason}`];
    this.flush();
    return { ...skill };
  }

  public deprecate(skillId: string, version: number): ProceduralSkillVersion {
    const skill = this.require(skillId, version);
    skill.status = 'DEPRECATED';
    skill.trustStatus = 'DEPRECATED';
    this.flush();
    return { ...skill };
  }

  public promote(skillId: string, version: number, betterThanKnownGood: boolean): ProceduralSkillVersion {
    const skill = this.require(skillId, version);
    if (!betterThanKnownGood) {
      throw Object.assign(new Error('Candidate was not better than the known-good skill.'), { reasonCode: 'CANDIDATE_REJECTED' });
    }
    const currentGood = this.knownGood.get(skillId);
    if (currentGood === version) return { ...skill, knownGood: true };
    skill.knownGood = true;
    if (currentGood !== undefined) {
      const previous = this.require(skillId, currentGood);
      previous.knownGood = true;
    }
    this.knownGood.set(skillId, version);
    skill.status = 'ACTIVE';
    if (skill.trustStatus === 'DRAFT') skill.trustStatus = 'REVIEW_REQUIRED';
    this.flush();
    return { ...skill };
  }

  public trust(skillId: string, version: number, actor: PrivilegeActor): ProceduralSkillVersion {
    assertOwnerSkillTrust(actor);
    const skill = this.require(skillId, version);
    if (!canTransitionTrust(skill.trustStatus, 'TRUSTED', actor)) {
      throw Object.assign(
        new Error('Skill must pass isolated review before owner trust.'),
        { reasonCode: 'REVIEW_REQUIRED' },
      );
    }
    skill.trustStatus = 'TRUSTED';
    skill.status = 'TRUSTED_INSTRUCTION';
    skill.knownGood = true;
    this.knownGood.set(skillId, version);
    this.flush();
    return { ...skill };
  }

  public rollback(skillId: string): ProceduralSkillVersion {
    const versions = this.versions.get(skillId) ?? [];
    const known = this.knownGood.get(skillId);
    const target = versions.find(item => item.version === known) ?? versions.find(item => item.knownGood);
    if (!target) {
      throw Object.assign(new Error('No known-good skill version exists to roll back to.'), { reasonCode: 'NO_KNOWN_GOOD' });
    }
    return { ...target };
  }

  public get(skillId: string, version: number): ProceduralSkillVersion | undefined {
    const found = this.versions.get(skillId)?.find(item => item.version === version);
    return found ? { ...found } : undefined;
  }

  public knownGoodVersion(skillId: string): ProceduralSkillVersion | undefined {
    const version = this.knownGood.get(skillId);
    return version === undefined ? undefined : this.get(skillId, version);
  }

  public list(): ProceduralSkillVersion[] {
    return [...this.versions.values()].flatMap(items => items.map(item => ({ ...item })));
  }

  public retrieveTrusted(query: string): ProceduralSkillVersion[] {
    return retrieveRelevantSkills(this.list().filter(isAutoSelectableSkill), query)
      .map(hit => hit.skill);
  }

  public retrieveForTask(query: string): ProceduralSkillVersion[] {
    return this.retrieveTrusted(query);
  }

  public autoPromote(): false {
    return autoPromoteSkill();
  }

  public productionPromotionAllowed(): false {
    return productionSkillPromotionAllowed();
  }

  public selfApprove(): false {
    return jarvisMaySelfApproveSkill();
  }

  public recordId(skillId: string, version: number): string {
    return skillRecordId(skillId, version);
  }

  private require(skillId: string, version: number): ProceduralSkillVersion {
    const found = this.versions.get(skillId)?.find(item => item.version === version);
    if (!found) throw Object.assign(new Error('Unknown skill version.'), { reasonCode: 'UNKNOWN_SKILL_VERSION' });
    return found;
  }

  private flush(): void {
    this.persist?.replace(this.list());
  }
}

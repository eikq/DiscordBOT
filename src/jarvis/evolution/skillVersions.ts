import type { JsonCollection } from './persistTypes';
import type { ProceduralSkillVersion } from './types';

export class SkillVersionRegistry {
  private readonly versions = new Map<string, ProceduralSkillVersion[]>();
  private readonly knownGood = new Map<string, number>();

  constructor(private readonly persist?: JsonCollection<ProceduralSkillVersion>) {
    for (const skill of persist?.load() ?? []) {
      const existing = this.versions.get(skill.skillId) ?? [];
      this.versions.set(skill.skillId, [...existing, skill]);
      if (skill.knownGood) this.knownGood.set(skill.skillId, skill.version);
    }
  }

  public propose(skill: Omit<ProceduralSkillVersion, 'version' | 'knownGood' | 'status' | 'scriptsAllowed'> & {
    status?: ProceduralSkillVersion['status'];
    parentVersion?: number;
  }): ProceduralSkillVersion {
    const existing = this.versions.get(skill.skillId) ?? [];
    const next: ProceduralSkillVersion = {
      ...skill,
      version: (existing.at(-1)?.version ?? 0) + 1,
      knownGood: false,
      status: skill.status ?? 'CANDIDATE',
      scriptsAllowed: false,
      parentVersion: skill.parentVersion ?? existing.at(-1)?.version,
    };
    this.versions.set(skill.skillId, [...existing, next]);
    this.flush();
    return { ...next };
  }

  public markTested(skillId: string, version: number, passed: boolean): ProceduralSkillVersion {
    const skill = this.require(skillId, version);
    skill.status = passed ? 'TESTED' : 'REJECTED';
    this.flush();
    return { ...skill };
  }

  public reject(skillId: string, version: number, reason: string): ProceduralSkillVersion {
    const skill = this.require(skillId, version);
    if (skill.knownGood) {
      throw Object.assign(new Error('Cannot reject the only known-good skill without rollback.'), { reasonCode: 'CANDIDATE_REJECTED' });
    }
    skill.status = 'REJECTED';
    skill.evidence = [...skill.evidence, `rejected:${reason}`];
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
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return this.list().filter(skill => {
      if (!skill.knownGood && skill.status !== 'ACTIVE' && skill.status !== 'TRUSTED_INSTRUCTION') {
        return false;
      }
      return skill.trigger.toLowerCase().includes(needle.slice(0, 48))
        || skill.purpose.toLowerCase().includes(needle.slice(0, 48))
        || needle.includes(skill.skillId.toLowerCase());
    });
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

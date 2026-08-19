import { readSkillMetadataPrefix } from './frontmatter';
import { SkillPolicy, type ValidatedSkillPath } from './SkillPolicy';
import type {
  JarvisSkillAllowlistConfig,
  JarvisSkillCatalog,
  JarvisSkillCatalogIssue,
  JarvisSkillMetadata,
} from './types';

function assertConfig(config: JarvisSkillAllowlistConfig): void {
  if (config.version !== 1) throw new Error('Unsupported Jarvis skill allowlist version.');
  for (const [name, value] of Object.entries({
    maxActiveSkillsPerTurn: config.maxActiveSkillsPerTurn,
    maxCatalogSkills: config.maxCatalogSkills,
    maxSkillChars: config.maxSkillChars,
    maxReferenceChars: config.maxReferenceChars,
  })) {
    if (!Number.isInteger(value) || value <= 0) throw new Error(`Invalid ${name} skill policy value.`);
  }
  if (config.maxActiveSkillsPerTurn > 3) {
    throw new Error('JF-SKILLS-001 allows at most three active skills per turn.');
  }
  if (!Array.isArray(config.skills)) throw new Error('Skill allowlist skills must be an array.');
}

function cloneMetadata(metadata: JarvisSkillMetadata): JarvisSkillMetadata {
  return {
    ...metadata,
    permissions: [...metadata.permissions],
    references: [...metadata.references],
    activationTerms: [...metadata.activationTerms],
  };
}

export class SkillRegistry {
  private readonly metadata = new Map<string, JarvisSkillMetadata>();
  private readonly paths = new Map<string, ValidatedSkillPath>();
  private readonly issues: JarvisSkillCatalogIssue[] = [];

  constructor(public readonly policy: SkillPolicy) {
    assertConfig(policy.config);
    this.discover();
  }

  public catalog(): JarvisSkillCatalog {
    return {
      available: true,
      skills: [...this.metadata.values()].map(cloneMetadata),
      issues: this.issues.map(issue => ({ ...issue })),
      ...(this.issues.length > 0 ? { reason: `${this.issues.length} skill catalog issue(s) detected.` } : {}),
    };
  }

  public get(id: string): JarvisSkillMetadata | undefined {
    const found = this.metadata.get(id);
    return found ? cloneMetadata(found) : undefined;
  }

  public pathFor(id: string): ValidatedSkillPath | undefined {
    const found = this.paths.get(id);
    return found ? { ...found } : undefined;
  }

  private discover(): void {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    for (const entry of this.policy.config.skills.slice(0, this.policy.config.maxCatalogSkills)) {
      if (seenIds.has(entry.id)) {
        this.issues.push({ skillId: entry.id, reason: 'Duplicate skill id in allowlist.' });
        continue;
      }
      seenIds.add(entry.id);
      try {
        const validated = this.policy.validateEntry(entry);
        const frontmatter = readSkillMetadataPrefix(validated.skillFile);
        const normalizedName = frontmatter.name.toLocaleLowerCase();
        if (seenNames.has(normalizedName)) throw new Error(`Duplicate skill name: ${frontmatter.name}`);
        seenNames.add(normalizedName);
        const metadata: JarvisSkillMetadata = {
          id: entry.id,
          name: frontmatter.name,
          description: frontmatter.description,
          source: entry.source,
          location: entry.location,
          trust: entry.trust,
          enabled: entry.enabled,
          version: entry.version || frontmatter.version,
          permissions: [...entry.permissions],
          scriptsAllowed: entry.scriptsAllowed === true,
          references: [...(entry.references || [])],
          activationTerms: [...(entry.activationTerms || [])],
        };
        this.metadata.set(entry.id, metadata);
        this.paths.set(entry.id, validated);
      } catch (error) {
        this.issues.push({
          skillId: entry.id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (this.policy.config.skills.length > this.policy.config.maxCatalogSkills) {
      this.issues.push({ reason: 'Skill allowlist exceeds the configured catalog limit.' });
    }
  }
}

export function validateJarvisSkillConfig(config: JarvisSkillAllowlistConfig): void {
  assertConfig(config);
}

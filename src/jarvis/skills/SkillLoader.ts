import fs from 'node:fs';
import path from 'node:path';
import { readSkillDocument } from './frontmatter';
import { SkillRegistry } from './SkillRegistry';
import type { ActivatedJarvisSkill, JarvisSkillMetadata } from './types';

function referenceMatches(relativePath: string, requested: Set<string>): boolean {
  const normalized = relativePath.replaceAll('\\', '/').toLocaleLowerCase();
  const basename = path.basename(normalized, path.extname(normalized));
  return requested.has(normalized) || requested.has(basename);
}

export class SkillLoader {
  constructor(private readonly registry: SkillRegistry) {}

  public load(metadata: JarvisSkillMetadata, referenceIds: string[] = []): ActivatedJarvisSkill {
    const policy = this.registry.policy;
    policy.assertActivatable(metadata);
    const location = this.registry.pathFor(metadata.id);
    if (!location) throw new Error(`Skill ${metadata.id} is unavailable.`);
    const document = readSkillDocument(location.skillFile, policy.config.maxSkillChars);
    if (document.name !== metadata.name) throw new Error(`Skill ${metadata.id} metadata changed after discovery.`);
    const blockedScripts = policy.findBlockedScripts(location.directory);
    const requested = new Set(referenceIds.map(value => value.trim().toLocaleLowerCase()).filter(Boolean));
    const references: ActivatedJarvisSkill['references'] = [];
    let referenceChars = 0;
    if (requested.size > 0 && metadata.permissions.includes('references')) {
      for (const relativePath of metadata.references) {
        if (!referenceMatches(relativePath, requested)) continue;
        const resolved = policy.resolveReference(location.directory, relativePath);
        const content = fs.readFileSync(resolved, 'utf8');
        referenceChars += content.length;
        if (referenceChars > policy.config.maxReferenceChars) {
          throw new Error(`Skill ${metadata.id} references exceed the aggregate context limit.`);
        }
        references.push({ path: relativePath.replaceAll('\\', '/'), content });
      }
    }
    return {
      metadata,
      instructions: document.instructions,
      references,
      blockedScripts,
    };
  }
}

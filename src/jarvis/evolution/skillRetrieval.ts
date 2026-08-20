import { isForbiddenGenericShell } from '../security/constants';
import type { ProceduralSkillVersion } from './types';
import { isAutoSelectableSkill } from './skillTrust';

const STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'and', 'are', 'for', 'from', 'help', 'how',
  'into', 'please', 'that', 'the', 'this', 'use', 'using', 'with', 'you', 'your',
]);

export type SkillRetrievalHit = {
  skill: ProceduralSkillVersion;
  score: number;
  authority: 'plan_only';
  overridesCapabilityHost: false;
};

function tokensOf(text: string): Set<string> {
  return new Set(
    text.toLocaleLowerCase()
      .split(/[^\p{L}\p{N}._-]+/u)
      .map(token => token.trim())
      .filter(token => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

export function scoreTrustedSkill(query: string, skill: ProceduralSkillVersion): number {
  if (!isAutoSelectableSkill(skill)) return 0;
  if (skill.requiredCapabilities.some(id => isForbiddenGenericShell(id))) return 0;
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;
  const queryTokens = tokensOf(needle);
  const hay = `${skill.skillId} ${skill.name} ${skill.goal} ${skill.purpose} ${skill.trigger} ${skill.triggerConditions.join(' ')} ${skill.steps.join(' ')}`.toLowerCase();
  let score = 0;
  if (hay.includes(needle.slice(0, 48))) score += 8;
  const skillTokens = tokensOf(hay);
  for (const token of queryTokens) {
    if (skillTokens.has(token)) score += 2;
  }
  for (const cap of skill.requiredCapabilities) {
    if (needle.includes(cap.toLowerCase())) score += 3;
  }
  return score;
}

export function retrieveRelevantSkills(
  skills: ProceduralSkillVersion[],
  query: string,
  limit = 4,
): SkillRetrievalHit[] {
  return skills
    .map(skill => ({
      skill,
      score: scoreTrustedSkill(query, skill),
      authority: 'plan_only' as const,
      overridesCapabilityHost: false as const,
    }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.skillId.localeCompare(right.skill.skillId))
    .slice(0, limit);
}

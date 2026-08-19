import type { SkillRef } from '../core/types';

export type JarvisSkillTrust = 'TRUSTED' | 'REVIEWED_COMMUNITY' | 'UNTRUSTED';
export type JarvisSkillPermission = 'instructions' | 'references';

export interface JarvisSkillAllowlistEntry {
  id: string;
  source: string;
  location: string;
  trust: JarvisSkillTrust;
  enabled: boolean;
  version?: string;
  permissions: JarvisSkillPermission[];
  scriptsAllowed?: boolean;
  references?: string[];
  activationTerms?: string[];
}

export interface JarvisSkillAllowlistConfig {
  version: 1;
  maxActiveSkillsPerTurn: number;
  maxCatalogSkills: number;
  maxSkillChars: number;
  maxReferenceChars: number;
  skills: JarvisSkillAllowlistEntry[];
}

export interface JarvisSkillMetadata {
  id: string;
  name: string;
  description: string;
  source: string;
  location: string;
  trust: JarvisSkillTrust;
  enabled: boolean;
  version?: string;
  permissions: JarvisSkillPermission[];
  scriptsAllowed: boolean;
  references: string[];
  activationTerms: string[];
}

export interface JarvisSkillCatalogIssue {
  skillId?: string;
  reason: string;
}

export interface JarvisSkillCatalog {
  available: boolean;
  skills: JarvisSkillMetadata[];
  issues: JarvisSkillCatalogIssue[];
  reason?: string;
}

export interface ActivatedJarvisSkill {
  metadata: JarvisSkillMetadata;
  instructions: string;
  references: Array<{ path: string; content: string }>;
  blockedScripts: string[];
}

export interface JarvisSkillActivationRequest {
  text: string;
  referenceIds?: string[];
}

export interface JarvisSkillActivationResult {
  skills: ActivatedJarvisSkill[];
  skillRefs: SkillRef[];
  promptBlock: string;
  degraded: boolean;
  reasons: string[];
}

export interface JarvisSkillHost {
  catalog(): JarvisSkillCatalog;
  activateForTurn(request: JarvisSkillActivationRequest): Promise<JarvisSkillActivationResult>;
}

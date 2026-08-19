import fs from 'node:fs';
import path from 'node:path';
import { SkillActivator } from './SkillActivator';
import { SkillPolicy } from './SkillPolicy';
import { SkillRegistry } from './SkillRegistry';
import type {
  JarvisSkillActivationRequest,
  JarvisSkillActivationResult,
  JarvisSkillAllowlistConfig,
  JarvisSkillCatalog,
  JarvisSkillHost,
} from './types';

export type CreateJarvisSkillRuntimeOptions = {
  workspaceRoot: string;
  config: JarvisSkillAllowlistConfig;
};

export class JarvisSkillRuntime implements JarvisSkillHost {
  private readonly registry: SkillRegistry;
  private readonly activator: SkillActivator;

  constructor(options: CreateJarvisSkillRuntimeOptions) {
    const policy = new SkillPolicy(options.workspaceRoot, options.config);
    this.registry = new SkillRegistry(policy);
    this.activator = new SkillActivator(this.registry);
  }

  public catalog(): JarvisSkillCatalog {
    return this.registry.catalog();
  }

  public async activateForTurn(request: JarvisSkillActivationRequest): Promise<JarvisSkillActivationResult> {
    return this.activator.activateForTurn(request);
  }
}

export class UnavailableJarvisSkillRuntime implements JarvisSkillHost {
  constructor(private readonly reason: string) {}

  public catalog(): JarvisSkillCatalog {
    return {
      available: false,
      skills: [],
      issues: [],
      reason: this.reason,
    };
  }

  public async activateForTurn(_request: JarvisSkillActivationRequest): Promise<JarvisSkillActivationResult> {
    return {
      skills: [],
      skillRefs: [],
      promptBlock: '',
      degraded: true,
      reasons: [this.reason],
    };
  }
}

export function createJarvisSkillRuntime(options: CreateJarvisSkillRuntimeOptions): JarvisSkillRuntime {
  return new JarvisSkillRuntime(options);
}

export function loadDefaultJarvisSkillRuntime(
  workspaceRoot = process.cwd(),
  configPath = path.join(workspaceRoot, 'config', 'jarvis', 'skills.allowlist.json'),
): JarvisSkillHost {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as JarvisSkillAllowlistConfig;
    return createJarvisSkillRuntime({ workspaceRoot, config: parsed });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return new UnavailableJarvisSkillRuntime(`Jarvis skill runtime unavailable (${detail}).`);
  }
}

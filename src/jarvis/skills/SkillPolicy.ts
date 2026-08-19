import fs from 'node:fs';
import path from 'node:path';
import type {
  JarvisSkillAllowlistConfig,
  JarvisSkillAllowlistEntry,
  JarvisSkillMetadata,
} from './types';

const SCRIPT_EXTENSIONS = new Set([
  '.bat', '.cmd', '.cjs', '.js', '.mjs', '.ps1', '.py', '.sh', '.ts', '.tsx',
]);
const MAX_DIRECTORY_ENTRIES = 256;

export type ValidatedSkillPath = {
  directory: string;
  skillFile: string;
};

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertPlainPath(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!isWithin(root, target)) throw new Error('Skill location escapes the allowed root.');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    if (fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symlinked skill path is not allowed: ${part}`);
    }
  }
}

export class SkillPolicy {
  public readonly workspaceRoot: string;
  public readonly runtimeSkillsRoot: string;

  constructor(
    workspaceRoot: string,
    public readonly config: JarvisSkillAllowlistConfig,
  ) {
    this.workspaceRoot = fs.realpathSync(workspaceRoot);
    this.runtimeSkillsRoot = path.join(this.workspaceRoot, 'config', 'jarvis', 'runtime-skills');
  }

  public validateEntry(entry: JarvisSkillAllowlistEntry): ValidatedSkillPath {
    if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(entry.id)) {
      throw new Error('Skill id contains unsupported characters.');
    }
    if (path.isAbsolute(entry.location)) throw new Error('Skill location must be project-relative.');
    const directory = path.resolve(this.workspaceRoot, entry.location);
    if (!isWithin(this.runtimeSkillsRoot, directory)) {
      throw new Error('Skill location must remain inside the allowed runtime-skills root.');
    }
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
      throw new Error('Skill location is missing or is not a directory.');
    }
    assertPlainPath(this.runtimeSkillsRoot, directory);
    const realDirectory = fs.realpathSync(directory);
    if (!isWithin(this.runtimeSkillsRoot, realDirectory)) {
      throw new Error('Resolved skill path escapes the allowed runtime-skills root.');
    }
    const skillFile = path.join(realDirectory, 'SKILL.md');
    if (!fs.existsSync(skillFile) || !fs.statSync(skillFile).isFile()) {
      throw new Error('SKILL.md is missing.');
    }
    if (fs.lstatSync(skillFile).isSymbolicLink()) throw new Error('Symlinked SKILL.md is not allowed.');
    if (fs.statSync(skillFile).size > this.config.maxSkillChars) {
      throw new Error(`SKILL.md exceeds the ${this.config.maxSkillChars}-character policy limit.`);
    }
    return { directory: realDirectory, skillFile };
  }

  public assertActivatable(metadata: JarvisSkillMetadata): void {
    if (!metadata.enabled) throw new Error(`Skill ${metadata.id} is disabled.`);
    if (metadata.trust === 'UNTRUSTED') throw new Error(`Skill ${metadata.id} is untrusted.`);
    if (!metadata.permissions.includes('instructions')) {
      throw new Error(`Skill ${metadata.id} is not permitted to load instructions.`);
    }
    if (metadata.scriptsAllowed) {
      throw new Error('JF-SKILLS-001 does not permit script execution.');
    }
  }

  public resolveReference(directory: string, relativePath: string): string {
    if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Reference path must be relative.');
    const resolved = path.resolve(directory, relativePath);
    if (!isWithin(directory, resolved)) throw new Error('Reference path traversal is not allowed.');
    assertPlainPath(directory, resolved);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`Skill reference is missing: ${relativePath}`);
    }
    if (fs.lstatSync(resolved).isSymbolicLink()) throw new Error('Symlinked references are not allowed.');
    const extension = path.extname(resolved).toLocaleLowerCase();
    if (extension !== '.md' && extension !== '.txt') {
      throw new Error(`Unsupported skill reference type: ${extension || '(none)'}`);
    }
    if (fs.statSync(resolved).size > this.config.maxReferenceChars) {
      throw new Error(`Skill reference exceeds the ${this.config.maxReferenceChars}-character policy limit.`);
    }
    return resolved;
  }

  public findBlockedScripts(directory: string): string[] {
    const blocked: string[] = [];
    let visited = 0;
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        visited += 1;
        if (visited > MAX_DIRECTORY_ENTRIES) throw new Error('Skill directory contains too many files.');
        const full = path.join(current, entry.name);
        const relative = path.relative(directory, full).replaceAll(path.sep, '/');
        if (entry.isSymbolicLink()) {
          blocked.push(`${relative} (symlink)`);
          continue;
        }
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (SCRIPT_EXTENSIONS.has(path.extname(entry.name).toLocaleLowerCase())) blocked.push(relative);
      }
    };
    walk(directory);
    return blocked.sort();
  }
}

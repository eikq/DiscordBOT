import fs from 'node:fs';
import path from 'node:path';
import { SAFE_ID_PATTERN } from './constants';
import type { ApplicationRecord, DesktopAllowlists, ProjectRecord } from './types';

type ApplicationConfig = {
  version?: number;
  applications?: Array<{
    id?: string;
    displayName?: string;
    candidates?: string[];
    allowedArgs?: string[];
  }>;
};

type ProjectConfig = {
  version?: number;
  projects?: Array<{
    id?: string;
    displayName?: string;
    path?: string;
    openWith?: string;
  }>;
};

type TrustedUrlConfig = {
  version?: number;
  trustedOrigins?: string[];
  trustedPathPrefixes?: string[];
};

function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? '');
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function firstExistingFile(candidates: string[]): string | undefined {
  for (const candidate of candidates) {
    const expanded = path.normalize(expandEnv(candidate));
    if (!expanded || expanded.includes('..')) continue;
    try {
      if (fs.existsSync(expanded) && fs.statSync(expanded).isFile()) return expanded;
    } catch {
      continue;
    }
  }
  return undefined;
}

function resolveProjectPath(workspaceRoot: string, configured: string): string | undefined {
  if (!configured.trim()) return undefined;
  const resolved = path.resolve(workspaceRoot, configured);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  try {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
  } catch {
    return undefined;
  }
  return undefined;
}

export function loadDesktopAllowlists(options: {
  workspaceRoot?: string;
  applicationsPath?: string;
  projectsPath?: string;
  trustedUrlsPath?: string;
} = {}): DesktopAllowlists {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const applicationsPath = options.applicationsPath
    ?? path.join(workspaceRoot, 'config', 'jarvis', 'applications.json');
  const projectsPath = options.projectsPath
    ?? path.join(workspaceRoot, 'config', 'jarvis', 'projects.json');
  const trustedUrlsPath = options.trustedUrlsPath
    ?? path.join(workspaceRoot, 'config', 'jarvis', 'trusted-urls.json');

  const applicationConfig = readJson<ApplicationConfig>(applicationsPath, { applications: [] });
  const projectConfig = readJson<ProjectConfig>(projectsPath, { projects: [] });
  const trusted = readJson<TrustedUrlConfig>(trustedUrlsPath, {
    trustedOrigins: [],
    trustedPathPrefixes: [],
  });

  const applications: ApplicationRecord[] = [];
  for (const entry of applicationConfig.applications ?? []) {
    if (!entry.id || !SAFE_ID_PATTERN.test(entry.id)) continue;
    const executable = firstExistingFile(entry.candidates ?? []);
    applications.push({
      id: entry.id,
      displayName: entry.displayName?.trim() || entry.id,
      ...(executable ? { executable } : {}),
      installed: Boolean(executable),
      allowedArgs: [],
    });
  }

  const projects: ProjectRecord[] = [];
  for (const entry of projectConfig.projects ?? []) {
    if (!entry.id || !SAFE_ID_PATTERN.test(entry.id)) continue;
    if (entry.openWith && entry.openWith !== 'explorer') continue;
    const resolved = resolveProjectPath(workspaceRoot, entry.path ?? '');
    projects.push({
      id: entry.id,
      displayName: entry.displayName?.trim() || entry.id,
      path: resolved ?? '',
      installed: Boolean(resolved),
      openWith: 'explorer',
    });
  }

  return {
    applications,
    projects,
    trustedOrigins: (trusted.trustedOrigins ?? []).filter(item => typeof item === 'string'),
    trustedPathPrefixes: (trusted.trustedPathPrefixes ?? []).filter(item => typeof item === 'string'),
    allowlistedWebHosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
    explorerExecutable: applications.find(item => item.id === 'explorer' && item.installed)?.executable,
    workspaceRoot,
  };
}

export function applicationById(lists: DesktopAllowlists, id: string): ApplicationRecord | undefined {
  return lists.applications.find(item => item.id === id);
}

export function projectById(lists: DesktopAllowlists, id: string): ProjectRecord | undefined {
  return lists.projects.find(item => item.id === id);
}

export function configuredApplicationIds(lists: DesktopAllowlists): string[] {
  return lists.applications.map(item => item.id);
}

export function configuredProjectIds(lists: DesktopAllowlists): string[] {
  return lists.projects.map(item => item.id);
}

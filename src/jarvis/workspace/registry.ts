import fs from 'node:fs';
import path from 'node:path';
import { SAFE_ID_PATTERN } from '../capabilities/actions/constants';
import { DEFAULT_WORKSPACE_ID } from './constants';
import type { WorkspaceRecord } from './types';

type WorkspaceFile = {
  version?: number;
  workspaces?: Array<{
    id?: string;
    displayName?: string;
    mode?: string;
    root?: string;
    include?: string[];
    exclude?: string[];
  }>;
};

export type WorkspaceRegistry = {
  list(): WorkspaceRecord[];
  get(id: string): WorkspaceRecord | undefined;
  defaultId(): string;
};

export function defaultWorkspacesConfigPath(hostRoot = process.cwd()): string {
  return path.join(hostRoot, 'config', 'jarvis', 'workspaces.json');
}

export function loadWorkspaceRegistry(options: {
  hostRoot?: string;
  configPath?: string;
  workspaces?: WorkspaceRecord[];
} = {}): WorkspaceRegistry {
  const hostRoot = path.resolve(options.hostRoot ?? process.cwd());
  const loaded = options.workspaces ?? readConfig(options.configPath ?? defaultWorkspacesConfigPath(hostRoot), hostRoot);
  const byId = new Map(loaded.map(item => [item.id, item]));
  return {
    list: () => [...byId.values()],
    get: id => byId.get(id),
    defaultId: () => (byId.has(DEFAULT_WORKSPACE_ID) ? DEFAULT_WORKSPACE_ID : [...byId.keys()][0] ?? DEFAULT_WORKSPACE_ID),
  };
}

function readConfig(configPath: string, hostRoot: string): WorkspaceRecord[] {
  let parsed: WorkspaceFile = {};
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as WorkspaceFile;
  } catch {
    parsed = {};
  }
  const records: WorkspaceRecord[] = [];
  for (const entry of parsed.workspaces ?? []) {
    if (!entry.id || !SAFE_ID_PATTERN.test(entry.id)) continue;
    if (entry.mode && entry.mode !== 'read_only') continue;
    const root = resolveRoot(hostRoot, entry.root ?? '.');
    if (!root) continue;
    records.push({
      id: entry.id,
      displayName: entry.displayName?.trim() || entry.id,
      mode: 'read_only',
      root,
      include: Array.isArray(entry.include) ? entry.include.filter(item => typeof item === 'string') : ['src/**', 'docs/**', '*.md'],
      exclude: Array.isArray(entry.exclude) ? entry.exclude.filter(item => typeof item === 'string') : [],
    });
  }
  return records;
}

function resolveRoot(hostRoot: string, configured: string): string | undefined {
  if (!configured.trim() || configured.includes('\0')) return undefined;
  if (/^\\\\/u.test(configured) || /^[a-zA-Z]:/u.test(configured) && path.relative(hostRoot, configured).startsWith('..')) {
    const resolvedAbsolute = path.resolve(configured);
    const relative = path.relative(hostRoot, resolvedAbsolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  }
  const resolved = path.resolve(hostRoot, configured);
  const relative = path.relative(hostRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
  try {
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return undefined;
    return fs.realpathSync.native(resolved);
  } catch {
    return undefined;
  }
}

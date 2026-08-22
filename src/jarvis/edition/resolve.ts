import fs from 'node:fs';
import path from 'node:path';
import type { JarvisEdition } from './types';

export function resolveJarvisEdition(env: NodeJS.ProcessEnv = process.env): JarvisEdition {
  const raw = String(env.JARVIS_EDITION || '').trim().toLowerCase();
  return raw === 'community' ? 'community' : 'owner';
}

export function isCommunityEdition(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveJarvisEdition(env) === 'community';
}

export function jarvisDataRoot(workspaceRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.JARVIS_DATA_ROOT?.trim()) return path.resolve(env.JARVIS_DATA_ROOT.trim());
  return path.join(
    workspaceRoot,
    'data',
    resolveJarvisEdition(env) === 'community' ? 'community' : 'jarvis',
  );
}

export function jarvisMemoryDbName(env: NodeJS.ProcessEnv = process.env): string {
  return resolveJarvisEdition(env) === 'community' ? 'community.db' : 'jarvis.db';
}

export function jarvisWorkspaceDirName(env: NodeJS.ProcessEnv = process.env): string {
  return resolveJarvisEdition(env) === 'community' ? 'workspaces' : 'builds';
}

export function jarvisWorkspaceLogicalPath(slug: string, env: NodeJS.ProcessEnv = process.env): string {
  const safe = slug.replace(/\\/gu, '/').replace(/^\/+|\/+$/gu, '');
  return resolveJarvisEdition(env) === 'community'
    ? `data/community/workspaces/${safe}`
    : `data/jarvis/builds/${safe}`;
}

export function ensureJarvisDataRoot(workspaceRoot = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  const root = jarvisDataRoot(workspaceRoot, env);
  for (const dir of [
    root,
    path.join(root, 'runtime'),
    path.join(root, 'obsidian'),
    path.join(root, jarvisWorkspaceDirName(env)),
    path.join(root, 'research'),
    path.join(root, 'audit'),
    path.join(root, 'workspace'),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return root;
}

export function assertNotOwnerJarvisRoot(candidate: string, workspaceRoot = process.cwd()): void {
  const ownerRoot = path.resolve(workspaceRoot, 'data', 'jarvis');
  const resolved = path.resolve(candidate);
  if (resolved === ownerRoot || resolved.startsWith(`${ownerRoot}${path.sep}`)) {
    throw new Error('Community Edition must not use the owner data/jarvis root.');
  }
}

export function applyCommunityEditionEnv(env: NodeJS.ProcessEnv = process.env, workspaceRoot = process.cwd()): void {
  env.JARVIS_EDITION = 'community';
  env.JARVIS_STANDALONE = '1';
  env.HOST = '127.0.0.1';
  env.JARVIS_COMMUNITY_PROVIDER_LOCK = '1';
  if (!env.PORT?.trim()) env.PORT = '3012';
  if (env.JARVIS_DATA_ROOT?.trim()) {
    assertNotOwnerJarvisRoot(env.JARVIS_DATA_ROOT, workspaceRoot);
  }
  const root = ensureJarvisDataRoot(workspaceRoot, env);
  assertNotOwnerJarvisRoot(root, workspaceRoot);
  if (!env.JARVIS_RUNTIME_DIR?.trim()) env.JARVIS_RUNTIME_DIR = path.join(root, 'runtime');
}

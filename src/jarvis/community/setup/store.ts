import fs from 'node:fs';
import path from 'node:path';
import { jarvisDataRoot } from '../../edition/resolve';
import {
  COMMUNITY_SETUP_SCHEMA,
  DEFAULT_COMMUNITY_SETUP,
  type CommunitySetupState,
  type CommunityServiceId,
} from './types';

export function communitySetupPath(dataRoot = jarvisDataRoot()): string {
  return path.join(dataRoot, 'config', 'setup.json');
}

export function setupIsComplete(state: CommunitySetupState | null | undefined): boolean {
  return Boolean(state?.completed && state.schemaVersion === COMMUNITY_SETUP_SCHEMA);
}

export function shouldRedirectToCommunitySetup(
  payload: { completed?: boolean } | null | undefined,
  httpOk: boolean,
): boolean {
  return httpOk && payload?.completed === false;
}

export function readCommunitySetup(dataRoot = jarvisDataRoot()): CommunitySetupState {
  const file = communitySetupPath(dataRoot);
  if (!fs.existsSync(file)) return { ...DEFAULT_COMMUNITY_SETUP, model: { ...DEFAULT_COMMUNITY_SETUP.model } };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<CommunitySetupState>;
    return normalizeSetup(raw);
  } catch {
    return { ...DEFAULT_COMMUNITY_SETUP, model: { ...DEFAULT_COMMUNITY_SETUP.model } };
  }
}

export function writeCommunitySetup(
  patch: Partial<CommunitySetupState> & { model?: Partial<CommunitySetupState['model']> },
  dataRoot = jarvisDataRoot(),
): CommunitySetupState {
  const current = readCommunitySetup(dataRoot);
  const next = normalizeSetup({
    ...current,
    ...patch,
    model: { ...current.model, ...patch.model },
    schemaVersion: COMMUNITY_SETUP_SCHEMA,
    updatedAt: new Date().toISOString(),
  });
  const dir = path.dirname(communitySetupPath(dataRoot));
  fs.mkdirSync(dir, { recursive: true });
  const serialized = JSON.stringify(next, null, 2);
  if (/api[_-]?key|sk-|secret/i.test(serialized) && next.model.hasApiKey && /"(sk-|apiKey|api_key)"/i.test(serialized)) {
    throw new Error('Setup config must not store API keys.');
  }
  fs.writeFileSync(communitySetupPath(dataRoot), serialized, 'utf8');
  return next;
}

function normalizeSetup(raw: Partial<CommunitySetupState>): CommunitySetupState {
  const managed = Array.isArray(raw.managedServiceIds)
    ? raw.managedServiceIds.filter((id): id is CommunityServiceId => id === 'jarvis-core' || id === 'local-ai')
    : [...DEFAULT_COMMUNITY_SETUP.managedServiceIds];
  if (!managed.includes('jarvis-core')) managed.unshift('jarvis-core');
  const model = raw.model || DEFAULT_COMMUNITY_SETUP.model;
  return {
    schemaVersion: COMMUNITY_SETUP_SCHEMA,
    completed: Boolean(raw.completed),
    language: raw.language === 'en' ? 'en' : 'th',
    profile: raw.profile === 'minimal' || raw.profile === 'custom' ? raw.profile : 'standard',
    autoStart: raw.autoStart !== false,
    closeBehavior: raw.closeBehavior === 'stop-owned-model' ? 'stop-owned-model' : 'keep-model',
    managedServiceIds: [...new Set(managed)],
    model: {
      mode: model.mode === 'managed' ? 'managed' : 'endpoint',
      baseUrl: sanitizeBaseUrl(model.baseUrl),
      modelId: String(model.modelId || 'local-model').slice(0, 120),
      hasApiKey: Boolean(model.hasApiKey),
      llamaServerPath: model.llamaServerPath ? String(model.llamaServerPath).slice(0, 500) : undefined,
      ggufPath: model.ggufPath ? String(model.ggufPath).slice(0, 500) : undefined,
      contextSize: Number.isFinite(model.contextSize) ? Math.max(512, Math.min(32768, Number(model.contextSize))) : 4096,
      port: Number.isFinite(model.port) ? Math.max(1024, Math.min(65535, Number(model.port))) : 8086,
      alias: model.alias ? String(model.alias).slice(0, 80) : undefined,
    },
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

function sanitizeBaseUrl(value: unknown): string {
  const raw = String(value || 'http://127.0.0.1:8086/v1').trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_COMMUNITY_SETUP.model.baseUrl;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return DEFAULT_COMMUNITY_SETUP.model.baseUrl;
  }
}

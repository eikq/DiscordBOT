export type AgentRuntimeKind = 'legacy' | 'hermes';

export type HermesRuntimeConfig = {
  baseUrl: string;
  apiKey: string;
  requestTimeoutMs: number;
  profile?: string;
};

const DEFAULT_HERMES_BASE_URL = 'http://127.0.0.1:8642';
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function configuredAgentRuntime(env: NodeJS.ProcessEnv = process.env): AgentRuntimeKind {
  const value = String(env.JARVIS_AGENT_RUNTIME || 'legacy').trim().toLowerCase();
  return value === 'hermes' ? 'hermes' : 'legacy';
}

export function resolveHermesRuntimeConfig(env: NodeJS.ProcessEnv = process.env): HermesRuntimeConfig {
  const apiKey = String(env.JARVIS_HERMES_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('JARVIS_HERMES_API_KEY is required when Hermes runtime is configured.');
  }
  const timeout = Number(env.JARVIS_HERMES_TIMEOUT_MS || DEFAULT_REQUEST_TIMEOUT_MS);
  const profile = normalizeProfile(env.JARVIS_HERMES_PROFILE);
  return {
    baseUrl: hermesProfileBaseUrl(
      env.JARVIS_HERMES_BASE_URL || DEFAULT_HERMES_BASE_URL,
      profile,
    ),
    apiKey,
    requestTimeoutMs: Number.isFinite(timeout) && timeout > 0
      ? timeout
      : DEFAULT_REQUEST_TIMEOUT_MS,
    ...(profile ? { profile } : {}),
  };
}

export function hermesProfileBaseUrl(baseUrl: string, profile?: string): string {
  const base = normalizeBaseUrl(baseUrl);
  const normalizedProfile = normalizeProfile(profile);
  if (!normalizedProfile) return base;
  const existing = base.match(/\/p\/([a-z0-9_-]+)$/u);
  if (existing) {
    if (existing[1] === normalizedProfile) return base;
    throw new Error('JARVIS_HERMES_PROFILE conflicts with the profile already present in JARVIS_HERMES_BASE_URL.');
  }
  return `${base}/p/${normalizedProfile}`;
}

function normalizeProfile(value: string | undefined): string | undefined {
  const profile = String(value || '').trim().toLowerCase();
  if (!profile) return undefined;
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(profile)) {
    throw new Error('JARVIS_HERMES_PROFILE must be a lowercase Hermes profile name.');
  }
  return profile;
}

function normalizeBaseUrl(value: string): string {
  const trimmed = String(value || '').trim().replace(/\/+$/u, '');
  if (!/^https?:\/\//iu.test(trimmed)) {
    throw new Error('JARVIS_HERMES_BASE_URL must be an http(s) URL.');
  }
  return trimmed;
}

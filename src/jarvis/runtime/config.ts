export type AgentRuntimeKind = 'legacy' | 'hermes';

export type HermesRuntimeConfig = {
  baseUrl: string;
  apiKey: string;
  requestTimeoutMs: number;
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
  return {
    baseUrl: normalizeBaseUrl(env.JARVIS_HERMES_BASE_URL || DEFAULT_HERMES_BASE_URL),
    apiKey,
    requestTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_REQUEST_TIMEOUT_MS,
  };
}
function normalizeBaseUrl(value: string): string {
  const trimmed = String(value || '').trim().replace(/\/+$/u, '');
  if (!/^https?:\/\//iu.test(trimmed)) {
    throw new Error('JARVIS_HERMES_BASE_URL must be an http(s) URL.');
  }
  return trimmed;
}
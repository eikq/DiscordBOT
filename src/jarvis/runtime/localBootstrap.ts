import fs from 'node:fs';
import path from 'node:path';

export type OwnerHermesRuntimeBootstrap = {
  env: NodeJS.ProcessEnv;
  runtime: 'hermes' | 'legacy';
  source: 'explicit' | 'local-hermes' | 'legacy';
  profile?: string;
  secretSource?: 'jarvis-env' | 'hermes-local-env';
};

export type OwnerHermesRuntimeBootstrapOptions = {
  workspaceRoot?: string;
  localAppData?: string;
};

export function resolveOwnerHermesRuntimeBootstrap(
  env: NodeJS.ProcessEnv = process.env,
  options: OwnerHermesRuntimeBootstrapOptions = {},
): OwnerHermesRuntimeBootstrap {
  const next: NodeJS.ProcessEnv = { ...env };
  const explicit = clean(env.JARVIS_AGENT_RUNTIME)?.toLowerCase();
  if (explicit === 'legacy') {
    return { env: next, runtime: 'legacy', source: 'explicit' };
  }
  let secretSource: OwnerHermesRuntimeBootstrap['secretSource'];
  if (clean(next.JARVIS_HERMES_API_KEY)) {
    secretSource = 'jarvis-env';
  } else {
    const local = readLocalHermesEnv(options.localAppData ?? env.LOCALAPPDATA);
    if (local && local.API_SERVER_ENABLED?.toLowerCase() !== 'false' && clean(local.API_SERVER_KEY)) {
      next.JARVIS_HERMES_API_KEY = local.API_SERVER_KEY;
      next.JARVIS_HERMES_BASE_URL ||= `http://127.0.0.1:${clean(local.API_SERVER_PORT) || '8642'}`;
      secretSource = 'hermes-local-env';
    }
  }

  if (!clean(next.JARVIS_HERMES_API_KEY)) {
    if (explicit === 'hermes') {
      next.JARVIS_AGENT_RUNTIME = 'hermes';
      return { env: next, runtime: 'hermes', source: 'explicit' };
    }
    return { env: next, runtime: 'legacy', source: 'legacy' };
  }

  next.JARVIS_AGENT_RUNTIME = 'hermes';
  next.JARVIS_HERMES_PROFILE ||= 'jarvis';
  next.JARVIS_HERMES_MCP_SERVERS ||= 'serena-jarvis-hermes';
  next.JARVIS_PROJECT_ID ||= 'jarvis';
  next.JARVIS_WORKSPACE_ROOT ||= options.workspaceRoot || process.cwd();
  return {
    env: next,
    runtime: 'hermes',
    source: explicit === 'hermes' ? 'explicit' : 'local-hermes',
    profile: next.JARVIS_HERMES_PROFILE,
    ...(secretSource ? { secretSource } : {}),
  };
}

function readLocalHermesEnv(localAppData?: string): Record<string, string> | undefined {
  const root = clean(localAppData);
  if (!root) return undefined;
  const file = path.join(root, 'hermes', '.env');
  try {
    return parseEnv(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function parseEnv(text: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const raw of String(text || '').split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) output[key] = value;
  }
  return output;
}

function clean(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

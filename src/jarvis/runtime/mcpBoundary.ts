import type { HermesRuntimeConfig } from './config';
import type { AgentEvent, AgentRuntime } from './types';

export type McpRuntimeBoundaryPolicy = {
  profile: string;
  projectId: string;
  allowedServers: string[];
  workspaceRoot?: string;
};

export type McpRuntimeBoundarySnapshot = {
  profile: string;
  projectId: string;
  allowedServers: string[];
  workspaceRoot?: string;
  profileIsolationRequired: true;
  eventGuardEnabled: true;
  authorityGranted: false;
};

export type McpToolInspection = {
  tool?: string;
  isMcp: boolean;
  server?: string;
  allowed: boolean;
};

export class RuntimeMcpBoundaryError extends Error {
  public constructor(
    public readonly reasonCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeMcpBoundaryError';
  }
}

export class AgentRuntimeMcpBoundary {
  private readonly profile: string;
  private readonly projectId: string;
  private readonly workspaceRoot?: string;
  private readonly allowedServers: string[];
  private readonly allowedNormalized: Set<string>;

  public constructor(
    private readonly runtime: AgentRuntime,
    policy: McpRuntimeBoundaryPolicy,
  ) {
    this.profile = requiredToken(policy.profile, 'Hermes profile');
    this.projectId = requiredToken(policy.projectId, 'JARVIS project id');
    this.workspaceRoot = clean(policy.workspaceRoot);
    this.allowedServers = uniqueServers(policy.allowedServers);
    this.allowedNormalized = new Set(this.allowedServers.map(normalizeServer));
  }

  public snapshot(): McpRuntimeBoundarySnapshot {
    return {
      profile: this.profile,
      projectId: this.projectId,
      allowedServers: [...this.allowedServers],
      ...(this.workspaceRoot ? { workspaceRoot: this.workspaceRoot } : {}),
      profileIsolationRequired: true,
      eventGuardEnabled: true,
      authorityGranted: false,
    };
  }

  public assertRuntimeConfig(config: HermesRuntimeConfig): void {
    if (config.profile !== this.profile) {
      throw new RuntimeMcpBoundaryError(
        'MCP_PROFILE_MISMATCH',
        `Hermes runtime profile must be ${this.profile}.`,
      );
    }
    if (!config.baseUrl.endsWith(`/p/${this.profile}`)) {
      throw new RuntimeMcpBoundaryError(
        'MCP_PROFILE_ROUTE_REQUIRED',
        'Hermes MCP isolation requires a profile-scoped API base URL.',
      );
    }
  }

  public inspectTool(tool?: string): McpToolInspection {
    const server = mcpServerFromToolName(tool);
    if (!server) {
      return { tool, isMcp: false, allowed: true };
    }
    return {
      tool,
      isMcp: true,
      server,
      allowed: this.allowedNormalized.has(normalizeServer(server)),
    };
  }

  public async *streamGuardedEvents(
    runId: string,
    signal?: AbortSignal,
  ): AsyncIterable<AgentEvent> {
    for await (const event of this.runtime.streamEvents(runId, signal)) {
      const inspected = this.inspectTool(event.tool);
      if (inspected.isMcp && !inspected.allowed) {
        try {
          await this.runtime.stop(runId);
        } catch {
          // The profile boundary remains authoritative even if stop transport fails.
        }
        throw new RuntimeMcpBoundaryError(
          'MCP_SERVER_OUT_OF_SCOPE',
          `Hermes attempted MCP server ${inspected.server || 'unknown'} outside JARVIS project scope.`,
        );
      }
      yield event;
    }
  }
}

export function resolveMcpRuntimeBoundaryPolicy(
  env: NodeJS.ProcessEnv = process.env,
): McpRuntimeBoundaryPolicy | undefined {
  const profile = clean(env.JARVIS_HERMES_PROFILE)?.toLowerCase();
  if (!profile) return undefined;
  const allowedServers = String(env.JARVIS_HERMES_MCP_SERVERS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return {
    profile: requiredToken(profile, 'Hermes profile'),
    projectId: clean(env.JARVIS_PROJECT_ID) || 'jarvis',
    allowedServers: uniqueServers(allowedServers),
    ...(clean(env.JARVIS_WORKSPACE_ROOT)
      ? { workspaceRoot: clean(env.JARVIS_WORKSPACE_ROOT) }
      : {}),
  };
}

export function createConfiguredMcpBoundary(
  runtime: AgentRuntime,
  env: NodeJS.ProcessEnv = process.env,
): AgentRuntimeMcpBoundary | undefined {
  const policy = resolveMcpRuntimeBoundaryPolicy(env);
  return policy ? new AgentRuntimeMcpBoundary(runtime, policy) : undefined;
}

export function mcpServerFromToolName(tool?: string): string | undefined {
  const value = clean(tool);
  if (!value) return undefined;
  if (value.startsWith('mcp__')) {
    const rest = value.slice('mcp__'.length);
    const separator = rest.indexOf('__');
    return separator > 0 ? rest.slice(0, separator) : undefined;
  }
  const colon = value.indexOf(':');
  if (colon > 0 && colon < value.length - 1) {
    return value.slice(0, colon);
  }
  return undefined;
}

function uniqueServers(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const cleanValue = requiredToken(value, 'MCP server');
    const normalized = normalizeServer(cleanValue);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(cleanValue);
  }
  return output;
}

function normalizeServer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function requiredToken(value: string, label: string): string {
  const normalized = clean(value);
  if (!normalized || !/^[a-z0-9][a-z0-9._-]{0,127}$/iu.test(normalized)) {
    throw new RuntimeMcpBoundaryError(
      'MCP_POLICY_INVALID',
      `${label} is invalid.`,
    );
  }
  return normalized;
}

function clean(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

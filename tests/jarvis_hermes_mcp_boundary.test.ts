import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRuntimeMcpBoundary,
  RuntimeMcpBoundaryError,
  hermesProfileBaseUrl,
  resolveHermesRuntimeConfig,
  resolveMcpRuntimeBoundaryPolicy,
} from '../src/jarvis/runtime';
import type { AgentEvent, AgentRuntime } from '../src/jarvis/runtime';

test('Hermes profile config scopes JARVIS to /p/jarvis', () => {
  assert.equal(
    hermesProfileBaseUrl('http://127.0.0.1:8642/', 'jarvis'),
    'http://127.0.0.1:8642/p/jarvis',
  );
  const config = resolveHermesRuntimeConfig({
    JARVIS_HERMES_API_KEY: 'test-key',
    JARVIS_HERMES_PROFILE: 'jarvis',
  });
  assert.equal(config.profile, 'jarvis');
  assert.equal(config.baseUrl, 'http://127.0.0.1:8642/p/jarvis');
});
test('MCP policy is profile-bound and fail-closed by default', () => {
  const policy = resolveMcpRuntimeBoundaryPolicy({
    JARVIS_HERMES_PROFILE: 'jarvis',
    JARVIS_PROJECT_ID: 'jarvis-owner',
    JARVIS_WORKSPACE_ROOT: 'C:\\repo',
  });
  assert.deepEqual(policy, {
    profile: 'jarvis',
    projectId: 'jarvis-owner',
    allowedServers: [],
    workspaceRoot: 'C:\\repo',
  });
});

test('boundary accepts only its profile-scoped runtime config', () => {
  const boundary = new AgentRuntimeMcpBoundary(fakeRuntime([]), {
    profile: 'jarvis', projectId: 'jarvis', allowedServers: ['serena-jarvis-hermes'],
  });
  boundary.assertRuntimeConfig({
    baseUrl: 'http://127.0.0.1:8642/p/jarvis', apiKey: 'x', requestTimeoutMs: 1000, profile: 'jarvis',
  });
  assert.throws(() => boundary.assertRuntimeConfig({
    baseUrl: 'http://127.0.0.1:8642', apiKey: 'x', requestTimeoutMs: 1000,
  }), (error: unknown) => error instanceof RuntimeMcpBoundaryError && error.reasonCode === 'MCP_PROFILE_MISMATCH');
});
test('Serena MCP event passes but Unity MCP event stops the run', async () => {
  const events: AgentEvent[] = [
    { type: 'tool.started', runId: 'run1', tool: 'mcp__serena_jarvis_hermes__find_symbol', raw: {} },
    { type: 'tool.started', runId: 'run1', tool: 'mcp__unity__Unity_GetProjectData', raw: {} },
  ];
  const runtime = fakeRuntime(events);
  const boundary = new AgentRuntimeMcpBoundary(runtime, {
    profile: 'jarvis', projectId: 'jarvis', allowedServers: ['serena-jarvis-hermes'],
  });
  const seen: AgentEvent[] = [];
  await assert.rejects(async () => {
    for await (const event of boundary.streamGuardedEvents('run1')) seen.push(event);
  }, (error: unknown) => error instanceof RuntimeMcpBoundaryError && error.reasonCode === 'MCP_SERVER_OUT_OF_SCOPE');
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.tool, 'mcp__serena_jarvis_hermes__find_symbol');
  assert.deepEqual((runtime as AgentRuntime & { stopped: string[] }).stopped, ['run1']);
});

test('CLI server:tool notation is normalized to the same MCP server identity', () => {
  const boundary = new AgentRuntimeMcpBoundary(fakeRuntime([]), {
    profile: 'jarvis', projectId: 'jarvis', allowedServers: ['serena-jarvis-hermes'],
  });
  assert.equal(boundary.inspectTool('serena-jarvis-hermes:find_symbol').allowed, true);
  assert.equal(boundary.inspectTool('unity:Unity_GetProjectData').allowed, false);
  assert.equal(boundary.inspectTool('terminal').isMcp, false);
});
function fakeRuntime(events: AgentEvent[]): AgentRuntime & { stopped: string[] } {
  const stopped: string[] = [];
  return {
    stopped,
    getCapabilities: async () => ({ authRequired: true, features: {}, endpoints: {}, raw: {} }),
    startRun: async () => ({ runId: 'run1', status: 'started' }),
    getRun: async () => ({ runId: 'run1', status: 'running' }),
    async *streamEvents() { for (const event of events) yield event; },
    approve: async () => undefined,
    steer: async () => undefined,
    stop: async runId => { stopped.push(runId); },
    waitForRun: async () => ({ runId: 'run1', status: 'completed' }),
  };
}

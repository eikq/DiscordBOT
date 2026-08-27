import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSelfKnowledgeSnapshot,
  resolveCapabilityGoal,
  syncAgentRuntimeCapabilities,
} from '../src/jarvis/intelligence/index';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';
import type {
  AgentRunInput,
  AgentRuntime,
  RuntimeCapabilities,
} from '../src/jarvis/runtime/index';

const ALL_FEATURES = {
  run_submission: true,
  run_status: true,
  run_events_sse: true,
  run_stop: true,
  run_steer: true,
  run_approval_response: true,
};

const ALL_ENDPOINTS = {
  runs: { method: 'POST', path: '/v1/runs' },
  run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
  run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
  run_stop: { method: 'POST', path: '/v1/runs/{run_id}/stop' },
  run_steer: { method: 'POST', path: '/v1/runs/{run_id}/steer' },
  run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' },
};

test('Hermes discovery becomes evidence-only runtime declarations', async () => {
  const synced = await syncAgentRuntimeCapabilities(runtimeWith());
  assert.equal(synced.service.state, 'AVAILABLE');
  assert.equal(synced.declarations.length, 6);
  const submit = synced.declarations.find(item => item.id === 'runtime.hermes.run.submit');
  assert.ok(submit);
  assert.equal(submit.status, 'AVAILABLE');
  assert.equal(submit.permission.authorityGranted, false);
  assert.equal(submit.permission.ownerApprovalRequired, true);
  assert.ok(submit.evidence.includes('runtime-discovery:not-authority'));
});

test('Self Knowledge exposes Hermes evidence but never registers it as JARVIS authority', async () => {
  const snapshot = await buildSelfKnowledgeSnapshot({ agentRuntime: runtimeWith() });
  const submit = snapshot.capabilities.find(item => item.id === 'runtime.hermes.run.submit');
  assert.ok(submit);
  assert.equal(submit.registered, false);
  assert.equal(submit.status, 'AVAILABLE');
  assert.equal(submit.permission.authorityGranted, false);
  assert.ok(snapshot.services.some(item => item.id === 'hermes-agent-runtime' && item.state === 'AVAILABLE'));
});
test('Capability Graph refuses discovered Hermes control until a trusted JARVIS registration exists', async () => {
  const snapshot = await buildSelfKnowledgeSnapshot({ agentRuntime: runtimeWith() });
  const resolved = resolveCapabilityGoal({
    id: 'goal.runtime.submit',
    title: 'Submit through Hermes',
    dependencies: [{ capabilityId: 'runtime.hermes.run.submit', relation: 'REQUIRED' }],
  }, snapshot);
  assert.equal(resolved.ready, false);
  assert.deepEqual(resolved.selected, []);
  assert.equal(resolved.missing[0]?.capabilityId, 'runtime.hermes.run.submit');
  assert.equal(resolved.missing[0]?.status, 'AVAILABLE');
});

test('partial Hermes feature evidence degrades the runtime service honestly', async () => {
  const runtime = runtimeWith({ run_stop: false, run_steer: undefined });
  const synced = await syncAgentRuntimeCapabilities(runtime);
  assert.equal(synced.service.state, 'DEGRADED');
  assert.equal(synced.declarations.find(item => item.id === 'runtime.hermes.run.stop')?.status, 'UNAVAILABLE');
  assert.equal(synced.declarations.find(item => item.id === 'runtime.hermes.run.steer')?.status, 'UNKNOWN');
});

test('runtime probe failure is redacted and cannot turn into authority', async () => {
  const runtime = runtimeWith();
  runtime.getCapabilities = async () => { throw new Error('API_KEY=supersecret-runtime-key failed'); };
  const synced = await syncAgentRuntimeCapabilities(runtime);
  assert.equal(synced.service.state, 'UNAVAILABLE');
  assert.doesNotMatch(synced.service.detail || '', /supersecret-runtime-key/u);
  assert.ok(synced.declarations.every(item => item.permission.authorityGranted === false));
});
test('Lab runtime can observe Hermes without adding it to CapabilityHost', async () => {
  const lab = createJarvisLabRuntime({
    agentRuntime: runtimeWith(),
    commandCenter: false,
  });
  const snapshot = await lab.selfKnowledgeSnapshot({ services: [] });
  assert.ok(snapshot.capabilities.some(item => item.id === 'runtime.hermes.run.status'));
  assert.equal(snapshot.capabilities.find(item => item.id === 'runtime.hermes.run.status')?.registered, false);
  assert.equal(lab.capabilities(), undefined);
});

function runtimeWith(
  featureOverrides: Record<string, unknown> = {},
): AgentRuntime {
  const capabilities: RuntimeCapabilities = {
    platform: 'hermes-agent',
    model: 'hermes-agent',
    authRequired: true,
    features: { ...ALL_FEATURES, ...featureOverrides },
    endpoints: { ...ALL_ENDPOINTS },
    raw: {},
  };
  return {
    getCapabilities: async () => capabilities,
    startRun: async (_input: AgentRunInput) => ({ runId: 'run_sync', status: 'started' }),
    getRun: async runId => ({ runId, status: 'completed' }),
    streamEvents: async function* () { /* no events */ },
    approve: async () => undefined,
    steer: async () => undefined,
    stop: async () => undefined,
    waitForRun: async runId => ({ runId, status: 'completed' }),
  };
}

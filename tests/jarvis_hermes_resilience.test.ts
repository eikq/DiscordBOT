import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRuntimeBindingCoordinator,
  AgentRuntimeResilienceCoordinator,
  RuntimeResilienceError,
  type AgentRun,
  type AgentRuntime,
} from '../src/jarvis/runtime';

type FakeState = {
  starts: number;
  capabilities: number;
  startModel?: string;
  final: AgentRun;
};

const context = {
  jarvisSessionId: 'resilience-session',
  goalId: 'goal.resilience',
};

test('provider-managed run observes Hermes fallback without creating a JARVIS retry', async () => {
  const state: FakeState = {
    starts: 0,
    capabilities: 0,
    final: { runId: 'run_1', status: 'completed', model: 'fallback-model', output: 'done' },
  };
  const runtime = fakeRuntime(state, 'primary-model');
  const bindings = new AgentRuntimeBindingCoordinator(runtime);
  const coordinator = new AgentRuntimeResilienceCoordinator(runtime, bindings);
  const result = await coordinator.executeManagedRun(context, { input: 'do the work' });

  assert.equal(state.starts, 1);
  assert.equal(state.startModel, undefined);
  assert.equal(result.configuredModel, 'primary-model');
  assert.equal(result.finalModel, 'fallback-model');
  assert.equal(result.fallbackObserved, true);
  assert.equal(result.providerManagedFallback, true);
  assert.equal(result.jarvisRetryCreated, false);
  assert.equal(result.retryDisposition, 'NONE');
});

test('final Hermes failure is surfaced without blind JARVIS retry', async () => {
  const state: FakeState = {
    starts: 0,
    capabilities: 0,
    final: {
      runId: 'run_1', status: 'failed', model: 'last-fallback',
      error: 'Provider chain exhausted; Bearer sk-test-secret should redact.',
    },
  };
  const runtime = fakeRuntime(state, 'primary-model');
  const coordinator = new AgentRuntimeResilienceCoordinator(
    runtime,
    new AgentRuntimeBindingCoordinator(runtime),
  );
  const result = await coordinator.executeManagedRun(context, { input: 'do the work once' });

  assert.equal(state.starts, 1);
  assert.equal(result.finalRun.status, 'failed');
  assert.equal(result.retryDisposition, 'SURFACE_FINAL_FAILURE');
  assert.equal(result.jarvisRetryCreated, false);
  assert.doesNotMatch(result.error || '', /sk-test-secret/u);
});

test('provider-managed path rejects a model pin before starting Hermes', async () => {
  const state: FakeState = {
    starts: 0,
    capabilities: 0,
    final: { runId: 'run_1', status: 'completed' },
  };
  const runtime = fakeRuntime(state, 'primary-model');
  const coordinator = new AgentRuntimeResilienceCoordinator(
    runtime,
    new AgentRuntimeBindingCoordinator(runtime),
  );
  await assert.rejects(
    () => coordinator.startManagedRun(context, { input: 'pin this', model: 'manual-model' }),
    (error: unknown) => {
      assert.ok(error instanceof RuntimeResilienceError);
      assert.equal(error.reasonCode, 'RUNTIME_MODEL_PIN_FORBIDDEN');
      return true;
    },
  );
  assert.equal(state.starts, 0);
});

test('capability probe failure does not prevent the single managed run', async () => {
  const state: FakeState = {
    starts: 0,
    capabilities: 0,
    final: { runId: 'run_1', status: 'completed', model: 'runtime-model' },
  };
  const runtime = fakeRuntime(state, undefined, true);
  const coordinator = new AgentRuntimeResilienceCoordinator(
    runtime,
    new AgentRuntimeBindingCoordinator(runtime),
  );
  const result = await coordinator.executeManagedRun(context, { input: 'continue despite probe failure' });
  assert.equal(state.starts, 1);
  assert.equal(result.configuredModel, undefined);
  assert.equal(result.fallbackObserved, null);
});
function fakeRuntime(
  state: FakeState,
  configuredModel?: string,
  failCapabilityProbe = false,
): AgentRuntime {
  return {
    getCapabilities: async () => {
      state.capabilities += 1;
      if (failCapabilityProbe) throw new Error('probe unavailable');
      return { authRequired: true, model: configuredModel, features: {}, endpoints: {}, raw: {} };
    },
    startRun: async input => {
      state.starts += 1;
      state.startModel = input.model;
      return { runId: 'run_1', status: 'started', model: configuredModel };
    },
    getRun: async () => state.final,
    streamEvents: async function* () { /* no events */ },
    approve: async () => undefined,
    steer: async () => undefined,
    stop: async () => undefined,
    waitForRun: async () => state.final,
  };
}

test('opaque Hermes model identity does not claim fallback absence', async () => {
  const state: FakeState = {
    starts: 0,
    capabilities: 0,
    final: { runId: 'run_1', status: 'completed', model: 'hermes-agent' },
  };
  const runtime = fakeRuntime(state, 'hermes-agent');
  const coordinator = new AgentRuntimeResilienceCoordinator(
    runtime,
    new AgentRuntimeBindingCoordinator(runtime),
  );
  const result = await coordinator.executeManagedRun(context, { input: 'opaque model evidence' });
  assert.equal(result.fallbackObserved, null);
  assert.equal(result.jarvisRetryCreated, false);
});
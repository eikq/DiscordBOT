import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRuntimeAuthorityBroker,
  AgentRuntimeBindingCoordinator,
  RuntimeAuthorityError,
  type AgentRunInput,
  type AgentRuntime,
  type ApprovalDecision,
} from '../src/jarvis/runtime';
import { EmergencyStopController } from '../src/jarvis/security/emergencyStop';
import { PrivilegeLeaseStore } from '../src/jarvis/security/privilegeLease';

type RuntimeCallState = {
  approvals: Array<{ runId: string; decision: ApprovalDecision; resolveAll: boolean }>;
  steers: Array<{ runId: string; instruction: string }>;
  stops: string[];
  stopped: Set<string>;
};

const goalContext = {
  actor: 'owner' as const,
  jarvisSessionId: 'session-owner',
  goalId: 'goal.safe-build',
};
test('owner may forward one scoped Hermes approval only', async () => {
  const { runtime, state } = runtimeMock();
  const bindings = new AgentRuntimeBindingCoordinator(runtime);
  await bindings.startBoundRun({
    jarvisSessionId: goalContext.jarvisSessionId,
    goalId: goalContext.goalId,
  }, { input: 'inspect and wait for approval' });
  const broker = new AgentRuntimeAuthorityBroker(runtime, bindings);

  const receipt = await broker.approve('run_1', 'once', goalContext);
  assert.equal(receipt.action, 'approve');
  assert.equal(receipt.actor, 'owner');
  assert.deepEqual(state.approvals, [{ runId: 'run_1', decision: 'once', resolveAll: false }]);
  assert.equal(bindings.hasRun('run_1'), true);
  assert.equal(bindings.listBindings().length, 1);
});

test('persistent and bulk Hermes approval fail closed without a mapped JARVIS lease', async () => {
  const { runtime, state } = runtimeMock();
  const bindings = await boundGoal(runtime);
  const broker = new AgentRuntimeAuthorityBroker(runtime, bindings);

  await expectReason(() => broker.approve('run_1', 'session', goalContext), 'PERSISTENT_RUNTIME_APPROVAL_UNMAPPED');
  await expectReason(() => broker.approve('run_1', 'always', goalContext), 'PERSISTENT_RUNTIME_APPROVAL_UNMAPPED');
  await expectReason(() => broker.approve('run_1', 'once', goalContext, true), 'BULK_RUNTIME_APPROVAL_UNMAPPED');
  assert.deepEqual(state.approvals, []);
});
test('model and JARVIS identities cannot control a bound Hermes run', async () => {
  const { runtime, state } = runtimeMock();
  const bindings = await boundGoal(runtime);
  const broker = new AgentRuntimeAuthorityBroker(runtime, bindings);

  await expectReason(() => broker.approve('run_1', 'once', { ...goalContext, actor: 'jarvis' }), 'OWNER_RUNTIME_APPROVAL_REQUIRED');
  await expectReason(() => broker.deny('run_1', { ...goalContext, actor: 'model' }), 'RUNTIME_SELF_CONTROL_FORBIDDEN');
  await expectReason(() => broker.steer('run_1', 'continue', { ...goalContext, actor: 'jarvis' }), 'RUNTIME_SELF_CONTROL_FORBIDDEN');
  await expectReason(() => broker.stop('run_1', { ...goalContext, actor: 'model' }), 'RUNTIME_SELF_CONTROL_FORBIDDEN');
  assert.deepEqual(state.approvals, []);
  assert.deepEqual(state.steers, []);
  assert.deepEqual(state.stops, []);
});

test('bound scope prevents cross-session and cross-goal runtime control', async () => {
  const { runtime } = runtimeMock();
  const bindings = await boundGoal(runtime);
  const broker = new AgentRuntimeAuthorityBroker(runtime, bindings);

  await expectReason(() => broker.stop('run_1', { ...goalContext, jarvisSessionId: 'other-session' }), 'RUNTIME_SCOPE_MISMATCH');
  await expectReason(() => broker.stop('run_1', { ...goalContext, goalId: 'goal.other' }), 'RUNTIME_SCOPE_MISMATCH');
  await expectReason(() => broker.stop('run_missing', goalContext), 'RUNTIME_RUN_NOT_BOUND');
});
test('system may deny or steer a correctly scoped run, but cannot approve it', async () => {
  const { runtime, state } = runtimeMock();
  const bindings = await boundGoal(runtime);
  const broker = new AgentRuntimeAuthorityBroker(runtime, bindings);
  const system = { ...goalContext, actor: 'system' as const };

  await broker.deny('run_1', system);
  await broker.steer('run_1', 'return to the verified path', system);
  await expectReason(() => broker.approve('run_1', 'once', system), 'OWNER_RUNTIME_APPROVAL_REQUIRED');

  assert.deepEqual(state.approvals, [{ runId: 'run_1', decision: 'deny', resolveAll: false }]);
  assert.deepEqual(state.steers, [{ runId: 'run_1', instruction: 'return to the verified path' }]);
});

test('Emergency Stop blocks approval and steering while preserving deny and stop', async () => {
  const { runtime, state } = runtimeMock();
  const bindings = await boundGoal(runtime);
  const emergency = new EmergencyStopController({ leases: new PrivilegeLeaseStore() });
  const broker = new AgentRuntimeAuthorityBroker(runtime, bindings, emergency);
  emergency.engage('system', 'test interlock');

  await expectReason(() => broker.approve('run_1', 'once', goalContext), 'EMERGENCY_STOP_ACTIVE');
  await expectReason(() => broker.steer('run_1', 'continue', goalContext), 'EMERGENCY_STOP_ACTIVE');
  await broker.deny('run_1', goalContext);
  await broker.stop('run_1', goalContext);
  assert.equal(state.approvals.at(-1)?.decision, 'deny');
  assert.deepEqual(state.stops, ['run_1']);
});
test('Emergency Stop participant dispatches stop for every bound Hermes run', async () => {
  const { runtime, state } = runtimeMock();
  const bindings = new AgentRuntimeBindingCoordinator(runtime);
  await bindings.startBoundRun({ jarvisSessionId: 's1', taskId: 'task_1' }, { input: 'first' });
  await bindings.startBoundRun({ jarvisSessionId: 's2', taskId: 'task_2' }, { input: 'second' });
  const emergency = new EmergencyStopController({ leases: new PrivilegeLeaseStore() });
  const broker = new AgentRuntimeAuthorityBroker(runtime, bindings, emergency);
  const unregister = broker.registerEmergencyStopParticipant();

  const snapshot = emergency.engage('system', 'owner requested stop');
  assert.equal(snapshot.cancellations.length, 2);
  assert.ok(snapshot.cancellations.every(item => item.state === 'CANCELLATION_REQUESTED'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(state.stops.sort(), ['run_1', 'run_2']);
  assert.ok(emergency.snapshot().cancellations.every(item => item.state === 'CANCELLED'));
  unregister();
});

async function boundGoal(runtime: AgentRuntime): Promise<AgentRuntimeBindingCoordinator> {
  const bindings = new AgentRuntimeBindingCoordinator(runtime);
  await bindings.startBoundRun({
    jarvisSessionId: goalContext.jarvisSessionId,
    goalId: goalContext.goalId,
  }, { input: 'bound test run' });
  return bindings;
}
function runtimeMock(): { runtime: AgentRuntime; state: RuntimeCallState } {
  let runCounter = 0;
  const state: RuntimeCallState = {
    approvals: [], steers: [], stops: [], stopped: new Set<string>(),
  };
  const runtime: AgentRuntime = {
    getCapabilities: async () => ({ authRequired: true, features: {}, endpoints: {}, raw: {} }),
    startRun: async (_input: AgentRunInput) => {
      runCounter += 1;
      return { runId: `run_${runCounter}`, status: 'started' };
    },
    getRun: async runId => ({ runId, status: state.stopped.has(runId) ? 'cancelled' : 'running' }),
    streamEvents: async function* () { /* no events */ },
    approve: async (runId, decision, resolveAll = false) => {
      state.approvals.push({ runId, decision, resolveAll });
    },
    steer: async (runId, instruction) => {
      state.steers.push({ runId, instruction });
    },
    stop: async runId => {
      state.stops.push(runId);
      state.stopped.add(runId);
    },
    waitForRun: async runId => ({ runId, status: state.stopped.has(runId) ? 'cancelled' : 'completed' }),
  };
  return { runtime, state };
}
async function expectReason(action: () => Promise<unknown>, reasonCode: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof RuntimeAuthorityError);
    assert.equal(error.reasonCode, reasonCode);
    return true;
  });
}

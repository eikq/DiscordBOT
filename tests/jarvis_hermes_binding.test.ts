import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRuntimeBindingCoordinator,
  createAgentRuntimeBinding,
  type AgentRunInput,
  type AgentRuntime,
} from '../src/jarvis/runtime/index';


test('same JARVIS session and goal produce a deterministic opaque Hermes scope', async () => {
  const context = {
    jarvisSessionId: 'owner-visible-session-123',
    goalId: 'goal.build.private-site',
    taskId: 'task_first',
  };
  const first = await createAgentRuntimeBinding(context);
  const second = await createAgentRuntimeBinding({ ...context, taskId: 'task_retry' });

  assert.equal(first.scopeKind, 'goal');
  assert.equal(first.hermesSessionId, second.hermesSessionId);
  assert.equal(first.hermesSessionKey, second.hermesSessionKey);
  assert.doesNotMatch(first.hermesSessionId, /owner-visible|private-site/u);
  assert.doesNotMatch(first.hermesSessionKey, /owner-visible/u);
});
test('different goals isolate Hermes sessions while retaining one JARVIS session memory scope', async () => {
  const first = await createAgentRuntimeBinding({
    jarvisSessionId: 'jarvis-lab',
    goalId: 'goal.research',
  });
  const second = await createAgentRuntimeBinding({
    jarvisSessionId: 'jarvis-lab',
    goalId: 'goal.build',
  });

  assert.notEqual(first.hermesSessionId, second.hermesSessionId);
  assert.equal(first.hermesSessionKey, second.hermesSessionKey);
});

test('binding scope precedence is goal, pending goal, task, then conversation', async () => {
  const session = 'scope-order';
  assert.equal((await createAgentRuntimeBinding({ jarvisSessionId: session, goalId: 'g', pendingGoalId: 'p', taskId: 't' })).scopeKind, 'goal');
  assert.equal((await createAgentRuntimeBinding({ jarvisSessionId: session, pendingGoalId: 'p', taskId: 't' })).scopeKind, 'pending_goal');
  assert.equal((await createAgentRuntimeBinding({ jarvisSessionId: session, taskId: 't' })).scopeKind, 'task');
  assert.equal((await createAgentRuntimeBinding({ jarvisSessionId: session })).scopeKind, 'conversation');
});
test('bound coordinator injects Hermes scope ids and records run correlation', async () => {
  let captured: AgentRunInput | undefined;
  const runtime = runtimeMock(input => {
    captured = input;
    return { runId: 'run_bound_1', status: 'started' };
  });
  const coordinator = new AgentRuntimeBindingCoordinator(runtime);
  const bound = await coordinator.startBoundRun({
    jarvisSessionId: 'owner-session',
    goalId: 'goal.owner.build',
    taskId: 'task_123',
    requestId: 'req_123',
  }, {
    input: 'Plan the work.',
    instructions: 'Do not mutate anything.',
  });

  assert.equal(captured?.sessionId, bound.binding.hermesSessionId);
  assert.equal(captured?.sessionKey, bound.binding.hermesSessionKey);
  assert.deepEqual(coordinator.bindingForRun('run_bound_1'), bound.binding);
  assert.equal(bound.binding.taskId, 'task_123');
});
test('binding coordinator forgets completed run correlation without changing runtime state', async () => {
  const coordinator = new AgentRuntimeBindingCoordinator(runtimeMock(() => ({ runId: 'run_forget', status: 'started' })));
  await coordinator.startBoundRun({ jarvisSessionId: 'session', taskId: 'task' }, { input: 'inspect only' });
  assert.ok(coordinator.bindingForRun('run_forget'));
  assert.equal(coordinator.forgetRun('run_forget'), true);
  assert.equal(coordinator.bindingForRun('run_forget'), undefined);
  assert.equal(coordinator.forgetRun('run_forget'), false);
});

test('binding refuses an empty owner session id', async () => {
  await assert.rejects(() => createAgentRuntimeBinding({ jarvisSessionId: '   ' }), /session id is required/u);
});

function runtimeMock(start: (input: AgentRunInput) => { runId: string; status: 'started' }): AgentRuntime {
  return {
    getCapabilities: async () => ({ authRequired: true, features: {}, endpoints: {}, raw: {} }),
    startRun: async input => start(input),
    getRun: async runId => ({ runId, status: 'completed' }),
    streamEvents: async function* () { /* no events */ },
    approve: async () => undefined,
    steer: async () => undefined,
    stop: async () => undefined,
    waitForRun: async runId => ({ runId, status: 'completed' }),
  };
}

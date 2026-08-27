import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionJournalCoordinator } from '../src/jarvis/executionJournal/coordinator';
import {
  AgentRuntimeJournalBridge,
  runtimeEvidenceRef,
  type AgentEvent,
  type AgentRuntime,
} from '../src/jarvis/runtime/index';

function proposedJournal(operationId = 'operation_hermes_bridge') {
  const journal = new ExecutionJournalCoordinator();
  const record = journal.propose({
    operationId,
    capabilityId: 'runtime.hermes.run.submit',
    goalId: 'goal.hermes.bridge',
    taskId: 'task_hermes_bridge',
    action: { objective: 'bounded runtime work' },
    scope: ['workspace:jarvis'],
    idempotencyClass: 'UNKNOWN',
  });
  return { journal, record };
}

test('Hermes lifecycle evidence does not change authoritative journal state', () => {
  const { journal, record } = proposedJournal();
  const bridge = new AgentRuntimeJournalBridge(runtimeMock([]), journal);
  const updated = bridge.recordEvent(record.operationId, event('run.completed', { output: 'done' }));
  assert.equal(updated.executionState, 'PROPOSED');
  assert.equal(updated.verificationState, 'NOT_STARTED');
  assert.equal(updated.evidenceRefs.length, 1);
  assert.match(updated.evidenceRefs[0], /^runtime:hermes:run\.completed:/u);
});
test('Hermes approval request is evidence, never a JARVIS permission grant', () => {
  const { journal, record } = proposedJournal('operation_hermes_approval');
  journal.transition(record.operationId, 'PREFLIGHTED', 'system');
  journal.transition(record.operationId, 'AUTHORIZED', 'system');
  const bridge = new AgentRuntimeJournalBridge(runtimeMock([]), journal);
  const updated = bridge.recordEvent(record.operationId, event('approval.request'));
  assert.equal(updated.executionState, 'AUTHORIZED');
  assert.equal(updated.evidenceRefs.length, 1);
});

test('high-volume message and reasoning events are not persisted', () => {
  const { journal, record } = proposedJournal('operation_hermes_delta');
  const bridge = new AgentRuntimeJournalBridge(runtimeMock([]), journal);
  bridge.recordEvent(record.operationId, event('message.delta', { delta: 'secret-looking payload' }));
  bridge.recordEvent(record.operationId, event('reasoning.available', { preview: 'hidden reasoning' }));
  assert.deepEqual(journal.get(record.operationId)?.evidenceRefs, []);
});

test('runtime evidence fingerprint never contains raw preview, output, or tool data', () => {
  const ref = runtimeEvidenceRef(event('tool.completed', {
    tool: 'API_KEY=supersecret-tool-name',
    preview: 'PASSWORD=hunter2',
    output: 'TOKEN=private-token',
  }));
  assert.match(ref, /^runtime:hermes:tool\.completed:[0-9a-f]{24}$/u);
  assert.doesNotMatch(ref, /supersecret|hunter2|private-token/u);
});
test('bridge consumes bounded lifecycle SSE into an existing operation only', async () => {
  const { journal, record } = proposedJournal('operation_hermes_stream');
  const runtime = runtimeMock([
    event('message.delta', { delta: 'ignored' }),
    event('tool.started', { tool: 'read_file' }),
    event('tool.completed', { tool: 'read_file' }),
    event('run.completed', { output: 'finished' }),
  ]);
  const bridge = new AgentRuntimeJournalBridge(runtime, journal);
  const updated = await bridge.observeRun(record.operationId, 'run_stream');
  assert.equal(updated.executionState, 'PROPOSED');
  assert.equal(updated.evidenceRefs.length, 3);
  assert.ok(updated.evidenceRefs.some(item => item.includes('tool.started')));
  assert.ok(updated.evidenceRefs.some(item => item.includes('run.completed')));
});

test('bridge refuses to create journal authority for an unknown operation', () => {
  const bridge = new AgentRuntimeJournalBridge(runtimeMock([]), new ExecutionJournalCoordinator());
  assert.throws(
    () => bridge.recordEvent('operation_unknown', event('run.completed')),
    /Unknown JARVIS execution journal operation/u,
  );
});

test('model identity cannot write execution journal evidence', () => {
  const { journal, record } = proposedJournal('operation_model_evidence');
  assert.throws(
    () => journal.recordEvidence(record.operationId, ['runtime:hermes:run.completed:1234567890abcdef'], 'model'),
    /Model identity cannot write authoritative execution journal evidence/u,
  );
});
function event(type: string, patch: Partial<AgentEvent> = {}): AgentEvent {
  return {
    type,
    runId: patch.runId || 'run_bridge',
    raw: patch.raw || {},
    ...patch,
  };
}

function runtimeMock(events: AgentEvent[]): AgentRuntime {
  return {
    getCapabilities: async () => ({ authRequired: true, features: {}, endpoints: {}, raw: {} }),
    startRun: async () => ({ runId: 'run_bridge', status: 'started' }),
    getRun: async runId => ({ runId, status: 'completed' }),
    streamEvents: async function* () {
      for (const item of events) yield item;
    },
    approve: async () => undefined,
    steer: async () => undefined,
    stop: async () => undefined,
    waitForRun: async runId => ({ runId, status: 'completed' }),
  };
}

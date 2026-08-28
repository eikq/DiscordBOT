import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRuntimeLearningBridge,
  AgentRuntimeMcpBoundary,
  AgentRuntimeMemoryBridge,
  AgentRuntimeOwnerTaskCoordinator,
  RuntimeOwnerTaskError,
} from '../src/jarvis/runtime';
import type { AgentEvent, AgentRunInput, AgentRuntime } from '../src/jarvis/runtime';
import {
  CapabilitySelfModel,
  ExperienceStore,
  FailureLedger,
  ReflectionLedger,
  SkillVersionRegistry,
} from '../src/jarvis/evolution';
import type { JarvisMemoryService } from '../src/jarvis/memory';

const SERENA_TOOL = 'mcp__serena_jarvis_hermes__get_current_config';
test('full read-only owner task composes Hermes boundaries without trusting raw output', async () => {
  const runtime = fakeRuntime([
    event('tool.started', SERENA_TOOL),
    event('tool.completed', SERENA_TOOL),
    event('run.completed'),
  ], { runId: 'run_full', status: 'completed', output: 'RAW_MODEL_OUTPUT_DO_NOT_PERSIST' });
  const state = learningStores();
  const coordinator = new AgentRuntimeOwnerTaskCoordinator({
    runtime,
    memory: new AgentRuntimeMemoryBridge(fakeMemory()),
    mcp: new AgentRuntimeMcpBoundary(runtime, {
      profile: 'jarvis', projectId: 'jarvis', allowedServers: ['serena-jarvis-hermes'],
    }),
    learning: new AgentRuntimeLearningBridge(state),
  });

  const result = await coordinator.executeReadOnly({
    objective: 'Inspect the active Serena project configuration.',
    binding: { jarvisSessionId: 'owner-session', goalId: 'goal-readonly' },
    allowedTools: [SERENA_TOOL],
    verify: ({ finalRun, tools }) => ({
      state: finalRun.status === 'completed' && tools.includes(SERENA_TOOL) ? 'VERIFIED' : 'FAILED_VERIFICATION',
      outcome: finalRun.status === 'completed' && tools.includes(SERENA_TOOL) ? 'success' : 'failure',
      summary: 'JARVIS independently verified the Serena project inspection.',
      evidence: ['verify:serena-project'],
    }),
  });
  assert.equal(result.readOnly, true);
  assert.equal(result.jarvisRetryCreated, false);
  assert.equal(result.bound.binding.scopeKind, 'goal');
  assert.match(result.bound.binding.hermesSessionId, /^jv_scope_/u);
  assert.deepEqual(result.tools, [SERENA_TOOL]);
  assert.equal(result.memoryProjection?.items.length, 1);
  assert.equal(result.memoryProjection?.items[0]?.canonicalId, 'public_context');
  assert.equal(result.memoryProjection?.omitted.privacy, 1);
  assert.equal(result.memoryCandidate?.classification, 'UNTRUSTED_CANDIDATE');
  assert.equal(result.learning?.skillCandidates[0]?.status, 'CANDIDATE');
  assert.equal(result.learning?.autoPromotion, false);
  const persisted = JSON.stringify({ experiences: state.experiences.list(), skills: state.skills.list() });
  assert.doesNotMatch(persisted, /RAW_MODEL_OUTPUT_DO_NOT_PERSIST/u);
  assert.match(runtime.startedInput.instructions || '', /PUBLIC_RUNTIME_CONTEXT/u);
  assert.doesNotMatch(runtime.startedInput.instructions || '', /PRIVATE_RUNTIME_CONTEXT/u);
});

test('read-only owner task stops a tool outside its explicit task allowlist', async () => {
  const runtime = fakeRuntime([
    event('tool.started', 'terminal'),
  ], { runId: 'run_terminal', status: 'cancelled' });
  const coordinator = new AgentRuntimeOwnerTaskCoordinator({ runtime });
  await assert.rejects(() => coordinator.executeReadOnly({
    objective: 'Inspect one value only.',
    binding: { jarvisSessionId: 'owner-session', taskId: 'task-readonly' },
    allowedTools: [SERENA_TOOL],
    verify: () => ({ state: 'VERIFIED', outcome: 'success', summary: 'not reached', evidence: [] }),
  }), (error: unknown) => error instanceof RuntimeOwnerTaskError
    && error.reasonCode === 'RUNTIME_READ_ONLY_TOOL_OUT_OF_SCOPE');
  assert.deepEqual(runtime.stopped, ['run_terminal']);
});
test('read-only coordinator rejects a success label without independent VERIFIED state', async () => {
  const runtime = fakeRuntime([
    event('run.completed'),
  ], { runId: 'run_unverified', status: 'completed', output: 'done' });
  const coordinator = new AgentRuntimeOwnerTaskCoordinator({ runtime });
  await assert.rejects(() => coordinator.executeReadOnly({
    objective: 'Inspect runtime status.',
    binding: { jarvisSessionId: 'owner-session' },
    verify: () => ({
      state: 'UNVERIFIED', outcome: 'success',
      summary: 'Model said it succeeded.', evidence: [],
    }),
  }), (error: unknown) => error instanceof RuntimeOwnerTaskError
    && error.reasonCode === 'RUNTIME_READ_ONLY_UNVERIFIED_SUCCESS');
});

test('read-only coordinator stops a run when its JARVIS deadline is exceeded', async () => {
  const runtime = fakeRuntime([], { runId: 'run_timeout', status: 'cancelled' });
  runtime.streamEvents = async function* (_runId, signal) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 5_000);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const error = new Error('aborted by deadline');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    });
  };
  const coordinator = new AgentRuntimeOwnerTaskCoordinator({ runtime });
  const started = Date.now();
  await assert.rejects(() => coordinator.executeReadOnly({
    objective: 'Inspect runtime status without hanging.',
    binding: { jarvisSessionId: 'owner-session', taskId: 'task-timeout' },
    timeoutMs: 40,
    verify: () => ({ state: 'VERIFIED', outcome: 'success', summary: 'not reached', evidence: [] }),
  }), (error: unknown) => error instanceof RuntimeOwnerTaskError
    && error.reasonCode === 'RUNTIME_READ_ONLY_TIMEOUT');
  assert.deepEqual(runtime.stopped, ['run_timeout']);
  assert.ok(Date.now() - started < 1_000);
});

test('read-only coordinator stops consuming SSE after a terminal run event', async () => {
  const runtime = fakeRuntime([], { runId: 'run_terminal_event', status: 'completed', output: 'done' });
  runtime.streamEvents = async function* () {
    yield { type: 'run.completed', runId: 'run_terminal_event', raw: {} };
    await new Promise<void>(() => undefined);
  };
  const coordinator = new AgentRuntimeOwnerTaskCoordinator({ runtime });
  const result = await coordinator.executeReadOnly({
    objective: 'Inspect runtime status.',
    binding: { jarvisSessionId: 'owner-session', taskId: 'task-terminal-event' },
    timeoutMs: 100,
    verify: ({ finalRun }) => ({
      state: finalRun.status === 'completed' ? 'VERIFIED' : 'FAILED_VERIFICATION',
      outcome: finalRun.status === 'completed' ? 'success' : 'failure',
      summary: 'Terminal event observed.',
      evidence: ['runtime-terminal-event'],
    }),
  });
  assert.equal(result.finalRun.status, 'completed');
  assert.deepEqual(runtime.stopped, []);
});

function learningStores() {
  return {
    experiences: new ExperienceStore(() => Date.UTC(2026, 7, 28)),
    reflections: new ReflectionLedger(),
    failures: new FailureLedger(),
    skills: new SkillVersionRegistry(),
    selfModel: new CapabilitySelfModel(() => Date.UTC(2026, 7, 28)),
  };
}

function event(type: string, tool?: string): AgentEvent {
  return { type, runId: 'run_full', ...(tool ? { tool } : {}), raw: {} };
}
function fakeMemory(): JarvisMemoryService {
  return {
    retrieveForTurn: () => ({
      degraded: false,
      promptBlock: '',
      items: [
        {
          canonicalId: 'public_context', type: 'semantic', status: 'active',
          text: 'PUBLIC_RUNTIME_CONTEXT', confidence: 0.9, privacyClass: 'public', sourceRefs: ['fixture:public'],
        },
        {
          canonicalId: 'private_context', type: 'semantic', status: 'active',
          text: 'PRIVATE_RUNTIME_CONTEXT', confidence: 0.9, privacyClass: 'private', sourceRefs: ['fixture:private'],
        },
      ],
    }),
  };
}

type FakeRuntime = AgentRuntime & {
  stopped: string[];
  startedInput: AgentRunInput;
};

function fakeRuntime(events: AgentEvent[], finalRun: { runId: string; status: 'completed' | 'failed' | 'cancelled'; output?: string }): FakeRuntime {
  const stopped: string[] = [];
  let startedInput: AgentRunInput = { input: '' };
  const runtime: FakeRuntime = {
    stopped,
    get startedInput() { return startedInput; },
    getCapabilities: async () => ({ authRequired: true, features: {}, endpoints: {}, raw: {} }),
    startRun: async input => {
      startedInput = { ...input };
      return { runId: finalRun.runId, status: 'started' };
    },
    getRun: async () => ({ ...finalRun }),
    async *streamEvents() { for (const item of events) yield item; },
    approve: async () => undefined,
    steer: async () => undefined,
    stop: async runId => { stopped.push(runId); },
    waitForRun: async () => ({ ...finalRun }),
  };
  return runtime;
}

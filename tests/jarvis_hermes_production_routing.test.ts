import assert from 'node:assert/strict';
import test from 'node:test';
import { JarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';
import type {
  AgentEvent,
  AgentRun,
  AgentRunInput,
  AgentRuntime,
  ApprovalDecision,
  RuntimeCapabilities,
  WaitForRunOptions,
} from '../src/jarvis/runtime';

class FakeConversationRuntime implements AgentRuntime {
  public starts = 0;
  public stopped = 0;
  public lastInput?: AgentRunInput;
  constructor(
    private readonly output = 'HERMES_PRIMARY_REPLY',
    private readonly failStart = false,
    private readonly model = 'hermes-agent',
  ) {}

  async getCapabilities(): Promise<RuntimeCapabilities> {
    return { platform: 'hermes-agent', model: this.model, authRequired: true, features: {}, endpoints: {}, raw: {} };
  }
  async startRun(input: AgentRunInput): Promise<AgentRun> {
    this.starts += 1;
    this.lastInput = input;
    if (this.failStart) throw new Error('synthetic gateway offline');
    return { runId: 'run_primary', status: 'started', sessionId: input.sessionId, model: this.model };
  }
  async getRun(): Promise<AgentRun> {
    return { runId: 'run_primary', status: 'completed', model: this.model, output: this.output };
  }
  async *streamEvents(): AsyncIterable<AgentEvent> {
    yield { type: 'run.started', runId: 'run_primary', raw: {} };
    yield { type: 'run.completed', runId: 'run_primary', raw: {} };
  }
  async approve(_runId: string, _decision: ApprovalDecision): Promise<void> {}
  async steer(): Promise<void> {}
  async stop(): Promise<void> { this.stopped += 1; }
  async waitForRun(_runId: string, _options?: WaitForRunOptions): Promise<AgentRun> {
    return this.getRun();
  }
}

function runtimeWith(agentRuntime: AgentRuntime) {
  return new JarvisLabRuntime({
    attachDefaultMemory: false,
    attachDefaultCapabilities: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
    workspace: false,
    commandCenter: false,
    agentRuntime,
    llm: { generateText: async () => { throw new Error('legacy answer path should not run'); } },
  });
}
test('owner conversation uses Hermes as the primary answer runtime', async () => {
  const agentRuntime = new FakeConversationRuntime();
  const runtime = runtimeWith(agentRuntime);
  const output = await runtime.ask({ text: 'hello', sessionId: 'primary-conversation' });
  assert.equal(output.result.answerIntent, 'agent_runtime_text');
  assert.equal(output.result.suggestedContent, 'HERMES_PRIMARY_REPLY');
  assert.match(output.presented.text, /HERMES_PRIMARY_REPLY/u);
  assert.equal(agentRuntime.starts, 1);
  assert.ok(agentRuntime.lastInput?.sessionId?.startsWith('jv_scope_'));
  assert.ok(agentRuntime.lastInput?.sessionKey?.startsWith('jv_session_'));
  assert.equal(output.result.verifiedFacts[0]?.value, 'hermes');
  assert.equal(output.result.unverifiedClaims[0]?.text, 'HERMES_PRIMARY_REPLY');
});

test('Hermes start failure is surfaced without blind legacy answer retry', async () => {
  const agentRuntime = new FakeConversationRuntime('unused', true);
  const runtime = runtimeWith(agentRuntime);
  const output = await runtime.ask({ text: 'hello', sessionId: 'runtime-offline' });
  assert.equal(output.result.answerIntent, 'agent_runtime_unavailable');
  assert.match(output.presented.text, /No blind local-model retry was started/u);
  assert.equal(agentRuntime.starts, 1);
});
test('model identity reports Hermes runtime evidence instead of hard-coded Qwen', async () => {
  const agentRuntime = new FakeConversationRuntime('unused', false, 'hermes-agent');
  const runtime = runtimeWith(agentRuntime);
  const output = await runtime.ask({ text: 'ตอนนี้ใช้โมเดลอะไร', sessionId: 'runtime-identity' });
  assert.equal(output.result.answerIntent, 'self_knowledge');
  assert.match(output.presented.text, /Hermes Agent/u);
  assert.doesNotMatch(output.presented.text, /Qwen/u);
  const fact = output.result.verifiedFacts.find(item => item.key === 'jarvis.modelIdentity');
  assert.deepEqual(fact?.value, {
    runtime: 'hermes',
    platform: 'hermes-agent',
    model: 'hermes-agent',
    providerManaged: true,
    opaqueModel: true,
  });
});

test('explicit empty tool allowlist blocks any runtime tool', async () => {
  class ToolRuntime extends FakeConversationRuntime {
    override async *streamEvents(): AsyncIterable<AgentEvent> {
      yield { type: 'tool.started', runId: 'run_primary', tool: 'terminal', raw: {} };
    }
  }
  const agentRuntime = new ToolRuntime();
  const runtime = runtimeWith(agentRuntime);
  const output = await runtime.ask({ text: 'hello', sessionId: 'tool-boundary' });
  assert.equal(output.result.answerIntent, 'agent_runtime_unavailable');
  assert.equal(agentRuntime.stopped, 1);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CommandCenterRuntime,
  FORBIDDEN_TRACE_KEYS,
  TraceStore,
  createCapabilityWorkInvoker,
  presentCommandCenter,
} from '../src/jarvis';
import { sanitizeTaskForPersist } from '../src/jarvis/agent/persistSanitize';
import { planForObjective } from '../src/jarvis/agent/plans';
import { CapabilityRegistry } from '../src/jarvis/capabilities/CapabilityRegistry';
import type { CapabilityHost, CapabilityResult } from '../src/jarvis/capabilities/types';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';
import { acceptSseSeq, uniqueEventsBySeq } from '../src/jarvis/ui/operationsView';

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function result(id: string, extra: Partial<CapabilityResult> = {}): CapabilityResult {
  return {
    capabilityId: id,
    status: 'ok',
    structured: { ok: true },
    content: extra.content ?? `${id} ok`,
    sourceUrls: extra.sourceUrls ?? [],
    untrustedOutput: extra.untrustedOutput ?? false,
    sideEffect: extra.sideEffect ?? 'read',
    ...extra,
  };
}

function testHost(handlers: Record<string, (input: Record<string, unknown>) => CapabilityResult | Promise<CapabilityResult>>): CapabilityHost {
  const registry = new CapabilityRegistry();
  for (const [id, invoke] of Object.entries(handlers)) {
    registry.register({
      descriptor: () => ({
        id,
        description: id,
        inputSchema: {},
        outputSchema: {},
        sideEffect: id.startsWith('desktop.') ? 'write' : 'read',
        requiredService: 'test',
        providerKind: 'local',
        timeoutMs: 1_000,
        untrustedOutput: id.startsWith('research.'),
      }),
      availability: async () => ({ id, availability: 'up', degraded: false }),
      invoke: async input => invoke(input),
    });
  }
  return registry;
}

test('research ask traces keep the same requestId and invoked capability', async () => {
  const seen: string[] = [];
  const host = testHost({
    'research.search': input => {
      seen.push(String(input.query || ''));
      return result('research.search', {
        content: 'untrusted docs',
        untrustedOutput: true,
        sourceUrls: ['https://example.com/qwen'],
        structured: { risk: 'READ_ONLY' },
      });
    },
  });
  const center = new CommandCenterRuntime({ host, persistRoot: tempRoot('jarvis-la-corr-') });
  const lab = createJarvisLabRuntime({
    capabilities: host,
    commandCenter: center,
    attachDefaultMemory: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
    workspace: false,
    llm: { generateText: async () => 'should not be required for research routing' },
  });
  const asked = await lab.ask({
    text: 'research the latest Qwen documentation',
    sessionId: 'la-corr',
  });
  assert.equal(asked.route?.route, 'RESEARCH');
  assert.ok(asked.taskId);
  assert.equal(asked.request.requestId, asked.request.requestId);
  const trace = center.traces.list().find(item => item.taskId === asked.taskId);
  assert.ok(trace);
  assert.equal(trace?.requestId, asked.request.requestId);
  assert.equal(trace?.sessionId, 'la-corr');
  assert.equal(trace?.turnId, asked.request.requestId);
  assert.equal(trace?.taskId, asked.taskId);
  assert.ok(trace?.capabilities?.some(item => item.id === 'research.search' && item.status === 'ok'));
  assert.ok(seen.length > 0);
  assert.doesNotMatch(JSON.stringify(trace), /confirmToken|scratchpad|chainOfThought/i);
  center.agent.store.close();
  center.persistence?.close();
});

test('capability ask records the host call in the trace instead of an empty array', async () => {
  const host = testHost({
    'system.status': () => result('system.status', {
      content: 'cpu ok',
      structured: { status: 'completed', risk: 'READ_ONLY' },
    }),
  });
  const center = new CommandCenterRuntime({ host, persistRoot: tempRoot('jarvis-la-cap-') });
  const lab = createJarvisLabRuntime({
    capabilities: host,
    commandCenter: center,
    attachDefaultMemory: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
    workspace: false,
    llm: { generateText: async () => 'should not greet a status request' },
  });
  const asked = await lab.ask({ text: 'สถานะระบบ', sessionId: 'la-cap' });
  assert.equal(asked.route?.route, 'CAPABILITY');
  const trace = center.traces.list().find(item => item.requestId === asked.request.requestId);
  assert.ok(trace);
  assert.equal(trace?.capabilities?.length, 1);
  assert.equal(trace?.capabilities?.[0]?.id, 'system.status');
  assert.equal(trace?.capabilities?.[0]?.status, 'ok');
  assert.equal(trace?.capabilities?.[0]?.risk, 'READ_ONLY');
  center.agent.store.close();
  center.persistence?.close();
});

test('latest command-center request follows conversation after research', async () => {
  const host = testHost({
    'research.search': () => result('research.search', { content: 'hits', untrustedOutput: true }),
    'system.status': () => result('system.status', {
      content: 'ok',
      structured: { status: 'completed', risk: 'READ_ONLY' },
    }),
  });
  const center = new CommandCenterRuntime({ host, persistRoot: tempRoot('jarvis-la-latest-') });
  const lab = createJarvisLabRuntime({
    capabilities: host,
    commandCenter: center,
    attachDefaultMemory: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
    workspace: false,
    llm: { generateText: async () => 'Hello — conversation only.' },
  });
  await lab.ask({ text: 'research the latest Qwen documentation', sessionId: 'la-latest' });
  assert.equal(presentCommandCenter(center.snapshot()).request?.route, 'RESEARCH');
  const hello = await lab.askStream({ text: 'hello', sessionId: 'la-latest' }, () => undefined);
  assert.equal(hello.route?.route, 'CONVERSATION');
  assert.equal(presentCommandCenter(center.snapshot()).request?.route, 'CONVERSATION');
  assert.equal(presentCommandCenter(center.snapshot()).request?.requestId, hello.request.requestId);
  await lab.ask({ text: 'explain recursion', sessionId: 'la-latest' });
  assert.equal(presentCommandCenter(center.snapshot()).request?.route, 'INFORMATION');
  await lab.ask({ text: 'สถานะระบบ', sessionId: 'la-latest' });
  assert.equal(presentCommandCenter(center.snapshot()).request?.route, 'CAPABILITY');
  center.agent.store.close();
  center.persistence?.close();
});

test('completed work DAG stays inspectable as a bounded last task', async () => {
  const host = testHost({
    'system.status': () => result('system.status', {
      content: 'ok',
      structured: { risk: 'READ_ONLY' },
    }),
  });
  const center = new CommandCenterRuntime({ host, persistRoot: tempRoot('jarvis-la-last-') });
  const first = await center.runObjective('Read system status');
  assert.equal(first.status, 'COMPLETED');
  assert.equal(center.snapshot().task, null);
  let presented = presentCommandCenter(center.snapshot());
  assert.equal(presented.task, null);
  assert.equal(presented.lastTask?.id, first.id);
  assert.equal(presented.lastTask?.status, 'COMPLETED');
  assert.ok((presented.lastTask?.steps.length || 0) > 0);
  assert.ok(presented.lastTask?.verification || presented.lastTask?.outcome);
  for (let i = 0; i < 5; i += 1) {
    await center.runObjective('Read system status');
  }
  presented = presentCommandCenter(center.snapshot());
  assert.equal(presented.recentTasks.length, 5);
  assert.ok(presented.lastTask?.id);
  assert.notEqual(presented.lastTask?.id, first.id);
  center.agent.store.close();
  center.persistence?.close();
});

test('permission wait presents ids and fail-closes without a valid owner grant', async () => {
  let invokes = 0;
  const host = testHost({
    'desktop.openTrustedUrl': input => {
      invokes += 1;
      if (!input.confirmation) {
        return result('desktop.openTrustedUrl', {
          status: 'confirmation_required',
          content: '',
          error: 'Allow once required',
          sideEffect: 'write',
          structured: {
            status: 'confirmation_required',
            proposalId: 'ap-la-open',
            confirmToken: 'owner-token-live',
            risk: 'CONFIRM_REQUIRED',
            url: 'https://example.com',
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
          },
        });
      }
      return result('desktop.openTrustedUrl', { content: 'opened once', structured: { risk: 'CONFIRM_REQUIRED' } });
    },
  });
  const center = new CommandCenterRuntime({
    host,
    persistRoot: tempRoot('jarvis-la-perm-'),
    invoke: createCapabilityWorkInvoker({ host }),
  });
  const paused = await center.runObjective('open https://example.com');
  assert.equal(paused.status, 'WAITING_PERMISSION');
  assert.equal(invokes, 1);
  const presented = presentCommandCenter(center.snapshot());
  assert.equal(presented.task?.status, 'WAITING_PERMISSION');
  assert.equal(presented.permission.waiting, true);
  assert.equal(presented.permission.taskId, paused.id);
  assert.ok(presented.permission.stepId);
  assert.equal(presented.permission.capability, 'desktop.openTrustedUrl');
  assert.equal(presented.permission.proposalId, 'ap-la-open');
  assert.equal(presented.permission.risk, 'CONFIRM_REQUIRED');
  assert.equal(presented.permission.scope?.url, 'https://example.com');
  assert.throws(() => center.agent.grantPermission(paused.id, {
    actor: 'owner',
    proposalId: 'ap-la-open',
    token: 'wrong-token',
    capability: 'desktop.openTrustedUrl',
  }));
  assert.equal(invokes, 1);
  const denied = center.agent.denyPermission(paused.id);
  assert.equal(denied.status, 'BLOCKED');
  assert.equal(invokes, 1);
  const persisted = sanitizeTaskForPersist(paused);
  assert.equal(JSON.stringify(persisted).includes('owner-token-live'), false);
  const plan = planForObjective('open https://example.com', 'desktop.openTrustedUrl');
  assert.equal(plan.some(step => step.kind === 'permission'), false);
  center.agent.store.close();
  center.persistence?.close();
});

test('valid owner grant resumes the same waiting step once', async () => {
  let invokes = 0;
  const host = testHost({
    'desktop.openTrustedUrl': input => {
      invokes += 1;
      if (!input.confirmation) {
        return result('desktop.openTrustedUrl', {
          status: 'confirmation_required',
          content: '',
          sideEffect: 'write',
          structured: {
            status: 'confirmation_required',
            proposalId: 'ap-la-grant',
            confirmToken: 'grant-once-token',
            risk: 'CONFIRM_REQUIRED',
          },
        });
      }
      assert.equal((input.confirmation as { token: string }).token, 'grant-once-token');
      return result('desktop.openTrustedUrl', { content: 'opened once' });
    },
  });
  const center = new CommandCenterRuntime({ host, persistRoot: tempRoot('jarvis-la-grant-') });
  const paused = await center.runObjective('open https://example.com');
  const waiting = paused.plan.find(step => step.status === 'waiting_permission');
  assert.ok(waiting);
  const done = await center.grantAndResume(paused.id, {
    actor: 'owner',
    stepId: waiting?.id,
    proposalId: 'ap-la-grant',
    token: 'grant-once-token',
    capability: 'desktop.openTrustedUrl',
  });
  assert.equal(done.status, 'COMPLETED');
  assert.equal(invokes, 2);
  assert.equal(waiting && done.plan.find(step => step.id === waiting.id)?.status, 'done');
  const trace = center.traces.list().at(-1);
  assert.ok(trace?.capabilities?.some(item => item.id === 'desktop.openTrustedUrl' && item.status === 'ok'));
  center.agent.store.close();
  center.persistence?.close();
});

test('SSE cursor drops duplicate seqs and present() unique-by-seq', () => {
  assert.equal(acceptSseSeq(10, 10), null);
  assert.equal(acceptSseSeq(10, 9), null);
  assert.equal(acceptSseSeq(10, 11), 11);
  const unique = uniqueEventsBySeq([
    { seq: 1, id: 'a' },
    { seq: 2, id: 'b' },
    { seq: 2, id: 'dup' },
    { seq: 3, id: 'c' },
  ]);
  assert.deepEqual(unique.map(item => item.id), ['a', 'b', 'c']);
});

test('trace store drops hidden reasoning and confirmation tokens', () => {
  const traces = new TraceStore();
  traces.record({
    requestId: 'jarvis-trace-safe',
    route: 'CAPABILITY',
    capabilities: [{ id: 'system.status', status: 'ok', risk: 'READ_ONLY' }],
    tokens: 10,
    tokensPerSec: 30,
    ...( {
      confirmToken: 'raw-confirm',
      thoughts: 'hidden chain',
      scratchpad: 'secret notes',
    } as Record<string, string> ),
  } as Parameters<TraceStore['record']>[0]);
  const recorded = traces.list(1)[0];
  assert.equal(recorded?.requestId, 'jarvis-trace-safe');
  assert.equal(recorded?.capabilities?.[0]?.id, 'system.status');
  assert.equal(recorded?.tokens, 10);
  assert.equal(recorded?.tokensPerSec, 30);
  const payload = JSON.stringify(recorded);
  for (const key of FORBIDDEN_TRACE_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(recorded, key), false, key);
  }
  assert.doesNotMatch(payload, /raw-confirm|hidden chain|secret notes/i);
});

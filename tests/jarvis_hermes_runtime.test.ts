import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HermesRuntimeAdapter,
  HermesRuntimeError,
  configuredAgentRuntime,
  resolveHermesRuntimeConfig,
} from '../src/jarvis/runtime';

test('Hermes runtime config is opt-in and requires a local secret', () => {
  assert.equal(configuredAgentRuntime({}), 'legacy');
  assert.equal(configuredAgentRuntime({ JARVIS_AGENT_RUNTIME: 'hermes' }), 'hermes');
  assert.throws(
    () => resolveHermesRuntimeConfig({ JARVIS_AGENT_RUNTIME: 'hermes' }),
    /JARVIS_HERMES_API_KEY/u,
  );
  assert.deepEqual(resolveHermesRuntimeConfig({
    JARVIS_HERMES_API_KEY: 'test-key',
    JARVIS_HERMES_BASE_URL: 'http://127.0.0.1:8642/',
    JARVIS_HERMES_TIMEOUT_MS: '3210',
  }), {
    baseUrl: 'http://127.0.0.1:8642',
    apiKey: 'test-key',
    requestTimeoutMs: 3210,
  });
});

test('Hermes adapter discovers capabilities and submits a bound run', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });    if (url.endsWith('/v1/capabilities')) {
      return json({
        platform: 'hermes-agent',
        model: 'hermes-agent',
        auth: { required: true },
        features: { run_submission: true, run_events_sse: true },
        endpoints: { runs: { method: 'POST', path: '/v1/runs' } },
      });
    }
    if (url.endsWith('/v1/runs')) {
      return json({ run_id: 'run_abc', status: 'started' }, 202);
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  const runtime = new HermesRuntimeAdapter({
    baseUrl: 'http://127.0.0.1:8642',
    apiKey: 'secret-test-key',
    requestTimeoutMs: 1000,
    fetchImpl: fakeFetch as typeof fetch,
  });

  const capabilities = await runtime.getCapabilities();
  assert.equal(capabilities.authRequired, true);
  assert.equal(capabilities.features.run_submission, true);
  const run = await runtime.startRun({
    input: 'inspect this goal',
    sessionId: 'goal-42',
    sessionKey: 'owner-session',
    instructions: 'Remain authority-bounded.',
  });
  assert.equal(run.runId, 'run_abc');
  assert.equal(run.status, 'started');
  const runCall = calls.find(item => item.url.endsWith('/v1/runs'))!;
  const headers = new Headers(runCall.init?.headers);
  assert.equal(headers.get('Authorization'), 'Bearer secret-test-key');
  assert.equal(headers.get('X-Hermes-Session-Key'), 'owner-session');
  assert.deepEqual(JSON.parse(String(runCall.init?.body)), {
    input: 'inspect this goal',
    session_id: 'goal-42',
    instructions: 'Remain authority-bounded.',
  });
});

test('Hermes adapter streams lifecycle events and exposes control endpoints', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/events')) {
      const stream = sseStream([
        { event: 'tool.started', run_id: 'run_stream', tool: 'terminal' },
        { event: 'tool.completed', run_id: 'run_stream', tool: 'terminal', duration: 0.2, error: false },
        { event: 'run.completed', run_id: 'run_stream', output: 'done' },
      ]);
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return json({ object: 'ok' });
  };  const runtime = new HermesRuntimeAdapter({
    baseUrl: 'http://127.0.0.1:8642',
    apiKey: 'secret-test-key',
    requestTimeoutMs: 1000,
    fetchImpl: fakeFetch as typeof fetch,
  });

  const events = [];
  for await (const event of runtime.streamEvents('run_stream')) events.push(event);
  assert.deepEqual(events.map(item => item.type), ['tool.started', 'tool.completed', 'run.completed']);
  assert.equal(events[0]?.tool, 'terminal');
  assert.equal(events[2]?.output, 'done');

  await runtime.approve('run_stream', 'once', true);
  await runtime.steer('run_stream', 'continue with the verified path');
  await runtime.stop('run_stream');
  const approval = calls.find(item => item.url.endsWith('/approval'))!;
  const steer = calls.find(item => item.url.endsWith('/steer'))!;
  const stop = calls.find(item => item.url.endsWith('/stop'))!;
  assert.deepEqual(JSON.parse(String(approval.init?.body)), { choice: 'once', resolve_all: true });
  assert.deepEqual(JSON.parse(String(steer.init?.body)), { input: 'continue with the verified path' });
  assert.deepEqual(JSON.parse(String(stop.init?.body)), {});
});

test('Hermes adapter polls to a terminal status', async () => {
  let polls = 0;
  const fakeFetch = async (): Promise<Response> => {
    polls += 1;
    return json(polls < 2
      ? { run_id: 'run_wait', status: 'running' }
      : { run_id: 'run_wait', status: 'completed', output: 'finished' });
  };  const runtime = new HermesRuntimeAdapter({
    baseUrl: 'http://127.0.0.1:8642',
    apiKey: 'secret-test-key',
    requestTimeoutMs: 1000,
    fetchImpl: fakeFetch as typeof fetch,
  });
  const run = await runtime.waitForRun('run_wait', { pollIntervalMs: 10, timeoutMs: 200 });
  assert.equal(run.status, 'completed');
  assert.equal(run.output, 'finished');
  assert.equal(polls, 2);
});

test('Hermes HTTP failures stay typed without leaking the bearer key', async () => {
  const fakeFetch = async (): Promise<Response> => json({
    error: { message: 'Run not found', code: 'run_not_found' },
  }, 404);
  const runtime = new HermesRuntimeAdapter({
    baseUrl: 'http://127.0.0.1:8642',
    apiKey: 'never-leak-this-key',
    requestTimeoutMs: 1000,
    fetchImpl: fakeFetch as typeof fetch,
  });
  await assert.rejects(runtime.getRun('missing'), (error: unknown) => {
    assert.ok(error instanceof HermesRuntimeError);
    assert.equal(error.status, 404);
    assert.equal(error.code, 'run_not_found');
    assert.doesNotMatch(error.message, /never-leak-this-key/u);
    return true;
  });
});
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseStream(events: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const frames = events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
  const midpoint = Math.max(1, Math.floor(frames.length / 2));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames.slice(0, midpoint)));
      controller.enqueue(encoder.encode(frames.slice(midpoint)));
      controller.close();
    },
  });
}
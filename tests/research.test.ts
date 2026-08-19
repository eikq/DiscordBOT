import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalLlmProvider } from '../src/bot/llm/LocalLlmProvider';
import { McpResearchGateway } from '../src/bot/research/McpResearchGateway';
import { ResearchAssistant } from '../src/bot/research/ResearchAssistant';

test('world intelligence blocks tools outside the read-only allowlist before connecting', async () => {
  const gateway = new McpResearchGateway();
  await assert.rejects(
    gateway.execute({ name: 'intel_aoi_delete', arguments: { name: 'home' } }),
    /not on the read-only allowlist/u,
  );
});

test('research assistant preserves the source ledger returned by tool execution', async () => {
  const gateway = {
    getToolDefinitions: async () => [{
      type: 'function',
      function: { name: 'intel_news_feed', description: 'news', parameters: { type: 'object' } },
    }],
    execute: async () => ({ content: '<untrusted_tool_output>fresh data</untrusted_tool_output>' }),
    getStatus: async () => ({ connected: true }),
    close: async () => undefined,
  };
  const llm = {
    generateWithTools: async (request: any) => {
      await request.executeTool({ name: 'intel_news_feed', arguments: {} });
      return {
        text: 'สรุปข่าวล่าสุด',
        calls: [{ name: 'intel_news_feed', arguments: {} }],
        sources: ['https://example.com/news'],
      };
    },
    getRuntimeStatus: async () => ({ model: 'test-qwen' }),
  };
  const assistant = new ResearchAssistant(llm as any, gateway as any);

  const answer = await assistant.ask('วันนี้มีข่าวอะไร');

  assert.equal(answer.answer, 'สรุปข่าวล่าสุด');
  assert.deepEqual(answer.toolsUsed, ['intel_news_feed']);
  assert.deepEqual(answer.sources, ['https://example.com/news']);
  assert.equal(assistant.getActivity().phase, 'complete');
});

test('research assistant lets the model recover when one live source fails', async () => {
  const gateway = {
    getToolDefinitions: async () => [{
      type: 'function',
      function: { name: 'intel_world_brief', description: 'brief', parameters: { type: 'object' } },
    }],
    execute: async () => { throw new Error('upstream timed out'); },
    getStatus: async () => ({ connected: true }),
    close: async () => undefined,
  };
  const llm = {
    generateWithTools: async (request: any) => {
      const evidence = await request.executeTool({ name: 'intel_world_brief', arguments: {} });
      assert.match(evidence.content, /"status":"unavailable"/u);
      assert.match(evidence.content, /upstream timed out/u);
      return {
        text: 'แหล่งสรุปข่าวโลกยังไม่พร้อม จึงยังยืนยันข้อมูลล่าสุดไม่ได้',
        calls: [{ name: 'intel_world_brief', arguments: {} }],
        sources: [],
      };
    },
    getRuntimeStatus: async () => ({ model: 'test-qwen' }),
  };
  const assistant = new ResearchAssistant(llm as any, gateway as any);

  const answer = await assistant.ask('สรุปข่าวโลกตอนนี้');

  assert.match(answer.answer, /ยังไม่พร้อม/u);
  assert.deepEqual(answer.toolsUsed, ['intel_world_brief']);
  assert.deepEqual(answer.sources, []);
  assert.equal(assistant.getActivity().phase, 'complete');
});

test('Ollama tool loop executes a requested tool and returns the final answer', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnabled = process.env.LLM_ENABLED;
  process.env.LLM_ENABLED = 'true';
  let requestCount = 0;
  const executed: string[] = [];
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestCount++;
    const body = JSON.parse(String(init?.body || '{}'));
    assert.equal(body.model, 'test-model');
    if (requestCount === 1) {
      return new Response(JSON.stringify({
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [{ function: { name: 'intel_status', arguments: {} } }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(body.messages.at(-1)?.role, 'tool');
    return new Response(JSON.stringify({
      message: { role: 'assistant', content: 'ระบบข้อมูลพร้อมแล้ว' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const provider = new LocalLlmProvider('http://127.0.0.1:11434/v1', 'test-model');
    const result = await provider.generateWithTools({
      userPrompt: 'status',
      tools: [{
        type: 'function',
        function: { name: 'intel_status', description: 'status', parameters: { type: 'object' } },
      }],
      executeTool: async call => {
        executed.push(call.name);
        return { content: 'ok', sources: ['https://example.com/status'] };
      },
    });

    assert.equal(result.text, 'ระบบข้อมูลพร้อมแล้ว');
    assert.deepEqual(executed, ['intel_status']);
    assert.deepEqual(result.sources, ['https://example.com/status']);
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.LLM_ENABLED;
    else process.env.LLM_ENABLED = previousEnabled;
  }
});

test('missing world-intel executable is reported as not_configured without inventing a connection', async () => {
  const previousCommand = process.env.WORLD_INTEL_MCP_COMMAND;
  const previousEnabled = process.env.RESEARCH_ENABLED;
  process.env.WORLD_INTEL_MCP_COMMAND = path.join(os.tmpdir(), 'digital-me-missing-world-intel-mcp.exe');
  delete process.env.RESEARCH_ENABLED;
  const gateway = new McpResearchGateway();
  try {
    const status = await gateway.getStatus();
    assert.equal(status.availability, 'not_configured');
    assert.equal(status.connected, false);
    assert.match(status.error || '', /missing|not installed/iu);
  } finally {
    if (previousCommand === undefined) delete process.env.WORLD_INTEL_MCP_COMMAND;
    else process.env.WORLD_INTEL_MCP_COMMAND = previousCommand;
    if (previousEnabled === undefined) delete process.env.RESEARCH_ENABLED;
    else process.env.RESEARCH_ENABLED = previousEnabled;
    await gateway.close();
  }
});

test('disabled research stays disabled and does not require an MCP binary', async () => {
  const previousEnabled = process.env.RESEARCH_ENABLED;
  process.env.RESEARCH_ENABLED = 'false';
  const gateway = new McpResearchGateway();
  try {
    const status = await gateway.getStatus();
    assert.equal(status.availability, 'disabled');
    assert.equal(status.enabled, false);
    assert.equal(status.connected, false);
  } finally {
    if (previousEnabled === undefined) delete process.env.RESEARCH_ENABLED;
    else process.env.RESEARCH_ENABLED = previousEnabled;
    await gateway.close();
  }
});

test('Ollama tool loop surfaces HTTP failures instead of returning an empty answer', async () => {
  const previousFetch = globalThis.fetch;
  const previousEnabled = process.env.LLM_ENABLED;
  const previousCooldown = process.env.LLM_RETRY_COOLDOWN_MS;
  process.env.LLM_ENABLED = 'true';
  process.env.LLM_RETRY_COOLDOWN_MS = '1';
  globalThis.fetch = (async () => new Response('nope', { status: 503 })) as typeof fetch;
  try {
    const provider = new LocalLlmProvider('http://127.0.0.1:11434/v1', 'test-model');
    await assert.rejects(
      provider.generateWithTools({
        userPrompt: 'status',
        tools: [{
          type: 'function',
          function: { name: 'intel_status', description: 'status', parameters: { type: 'object' } },
        }],
        executeTool: async () => ({ content: 'ok' }),
      }),
      /HTTP 503/u,
    );
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnabled === undefined) delete process.env.LLM_ENABLED;
    else process.env.LLM_ENABLED = previousEnabled;
    if (previousCooldown === undefined) delete process.env.LLM_RETRY_COOLDOWN_MS;
    else process.env.LLM_RETRY_COOLDOWN_MS = previousCooldown;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
});

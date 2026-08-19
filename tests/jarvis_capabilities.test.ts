import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_ALLOWED_TOOLS, McpResearchGateway } from '../src/bot/research/McpResearchGateway';
import {
  CapabilityRegistry,
  LAB_PING_CAPABILITY_ID,
  LocalLlmJarvisCore,
  capabilityResultToToolRef,
  createJarvisRequest,
  createStandaloneCapabilityHost,
  createWorldIntelCapabilityHandler,
  isWorldIntelReadOnlyTool,
  registerWorldIntelCapabilities,
  worldIntelCapabilityId,
} from '../src/jarvis';
import type { CapabilityHandler, CapabilityResult, WorldIntelCapabilityPort } from '../src/jarvis';

function fakeHandler(id: string, invoke: () => Promise<CapabilityResult>): CapabilityHandler {
  return {
    descriptor: () => ({
      id,
      description: `Test capability ${id}`,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
      sideEffect: 'read',
      requiredService: 'test',
      providerKind: 'local',
      timeoutMs: 50,
      untrustedOutput: true,
    }),
    availability: async () => ({ id, availability: 'up', degraded: false }),
    invoke,
  };
}

function okResult(id: string, content: string, sourceUrls: string[] = []): CapabilityResult {
  return {
    capabilityId: id,
    status: 'ok',
    structured: { status: 'ok', content, sources: sourceUrls },
    content,
    sourceUrls,
    untrustedOutput: true,
    sideEffect: 'read',
  };
}

function fakeWorldIntelPort(overrides: Partial<WorldIntelCapabilityPort> = {}): WorldIntelCapabilityPort {
  return {
    execute: async () => ({
      content: '<untrusted_tool_output>fresh data</untrusted_tool_output>',
      sources: ['https://example.com/news'],
    }),
    getStatus: async () => ({ availability: 'up', allowedTools: [...DEFAULT_ALLOWED_TOOLS] }),
    ...overrides,
  };
}

test('capability registration and lookup return typed metadata', () => {
  const registry = new CapabilityRegistry();
  registry.register(fakeHandler('local.echo', async () => okResult('local.echo', 'hi')));
  const found = registry.lookup('local.echo');
  assert.equal(found?.id, 'local.echo');
  assert.equal(found?.requiredService, 'test');
  assert.equal(found?.providerKind, 'local');
  assert.equal(found?.timeoutMs, 50);
  assert.equal(found?.untrustedOutput, true);
  assert.equal(registry.list().length, 1);
  assert.equal(registry.lookup('missing'), undefined);
});

test('duplicate capability registration is rejected', () => {
  const registry = new CapabilityRegistry();
  registry.register(fakeHandler('local.echo', async () => okResult('local.echo', 'hi')));
  assert.throws(
    () => registry.register(fakeHandler('local.echo', async () => okResult('local.echo', 'hi'))),
    /already registered/u,
  );
});

test('unavailable capability returns an explicit result instead of throwing', async () => {
  const registry = new CapabilityRegistry();
  const result = await registry.invoke({ id: 'missing.tool', input: {} });
  const availability = await registry.availability('missing.tool');
  assert.equal(result.status, 'unavailable');
  assert.match(result.error || '', /not registered/u);
  assert.equal(availability.availability, 'unavailable');
  assert.equal(availability.degraded, true);
  assert.equal(capabilityResultToToolRef(result).status, 'unavailable');
});

test('registry timeout is an explicit failure result', async () => {
  const registry = new CapabilityRegistry();
  registry.register(fakeHandler('slow.tool', async () => {
    await new Promise(resolve => setTimeout(resolve, 200));
    return okResult('slow.tool', 'late');
  }));
  const result = await registry.invoke({ id: 'slow.tool', input: {}, timeoutMs: 20 });
  assert.equal(result.status, 'timeout');
  assert.match(result.error || '', /timed out/u);
  assert.equal(capabilityResultToToolRef(result).status, 'unavailable');
});

test('handler failure is an explicit error result', async () => {
  const registry = new CapabilityRegistry();
  registry.register(fakeHandler('boom.tool', async () => {
    throw new Error('upstream failed');
  }));
  const result = await registry.invoke({ id: 'boom.tool', input: {} });
  assert.equal(result.status, 'error');
  assert.match(result.error || '', /upstream failed/u);
});

test('world-intel adapters are read-only with untrusted output metadata', async () => {
  const registry = new CapabilityRegistry();
  const ids = registerWorldIntelCapabilities(registry, fakeWorldIntelPort());
  const newsId = worldIntelCapabilityId('intel_news_feed');
  assert.ok(ids.includes(newsId));
  const descriptor = registry.lookup(newsId);
  assert.equal(descriptor?.sideEffect, 'read');
  assert.equal(descriptor?.untrustedOutput, true);
  assert.equal(descriptor?.requiredService, 'world-intel-mcp');
  assert.equal(descriptor?.providerKind, 'mcp');
  assert.equal(isWorldIntelReadOnlyTool('intel_news_feed'), true);
  assert.equal(isWorldIntelReadOnlyTool('intel_aoi_delete'), false);

  const result = await registry.invoke({ id: newsId, input: {} });
  assert.equal(result.status, 'ok');
  assert.equal(result.sideEffect, 'read');
  assert.equal(result.untrustedOutput, true);
  assert.match(result.content, /<untrusted_tool_output>/u);
  assert.match(result.content, /fresh data/u);
  assert.match(result.content, /<\/untrusted_tool_output>/u);
  assert.deepEqual(result.sourceUrls, ['https://example.com/news']);
  assert.equal(capabilityResultToToolRef(result).status, 'ok');
  assert.deepEqual(capabilityResultToToolRef(result).sourceUrls, ['https://example.com/news']);
});

test('mutating world-intel tools cannot be registered and stay rejected', async () => {
  const port = fakeWorldIntelPort({
    execute: async call => {
      throw new Error(`Research tool ${call.name} is not on the read-only allowlist.`);
    },
  });
  assert.throws(
    () => createWorldIntelCapabilityHandler('intel_aoi_delete', port),
    /not on the read-only allowlist/u,
  );
  const registry = new CapabilityRegistry();
  registerWorldIntelCapabilities(registry, port);
  assert.equal(registry.lookup(worldIntelCapabilityId('intel_aoi_delete')), undefined);
  const result = await registry.invoke({ id: worldIntelCapabilityId('intel_aoi_delete'), input: { name: 'home' } });
  assert.equal(result.status, 'unavailable');
});

test('world-intel adapter preserves McpResearchGateway allowlist rejection without connecting', async () => {
  const gateway = new McpResearchGateway();
  const registry = new CapabilityRegistry();
  registerWorldIntelCapabilities(registry, gateway);
  await assert.rejects(
    gateway.execute({ name: 'intel_aoi_delete', arguments: { name: 'home' } }),
    /not on the read-only allowlist/u,
  );
  const news = registry.lookup(worldIntelCapabilityId('intel_news_feed'));
  assert.equal(news?.sideEffect, 'read');
  assert.equal(news?.untrustedOutput, true);
  await gateway.close();
});

test('standalone capability host always includes lab.ping and can omit world-intel', async () => {
  const registry = createStandaloneCapabilityHost({ worldIntel: false });
  assert.ok(registry.lookup(LAB_PING_CAPABILITY_ID));
  assert.equal(registry.list().some(item => item.id.startsWith('world-intel.')), false);
  const ping = await registry.invoke({ id: LAB_PING_CAPABILITY_ID, input: {} });
  assert.equal(ping.status, 'ok');
  assert.equal(ping.content, 'pong');
  const missing = await registry.invoke({ id: 'lab.missing', input: {} });
  assert.equal(missing.status, 'unavailable');
});

test('Jarvis Core can request a capability without importing MCP types', async () => {
  const registry = new CapabilityRegistry();
  registry.register(fakeHandler('local.weather', async () => okResult(
    'local.weather',
    '<untrusted_tool_output>31c</untrusted_tool_output>',
    ['https://example.com/weather'],
  )));
  const core = new LocalLlmJarvisCore(
    { generateText: async () => 'ไม่ยืนยันอุณหภูมิจากเครื่องมือ' },
    { capabilities: registry },
  );
  const result = await core.handle(createJarvisRequest({
    text: 'อากาศเป็นไง',
    requestId: 'cap-1',
    capabilities: ['local.weather'],
  }));
  assert.equal(result.toolResults.length, 1);
  assert.equal(result.toolResults[0]?.toolName, 'local.weather');
  assert.equal(result.toolResults[0]?.status, 'ok');
  assert.deepEqual(result.toolResults[0]?.sourceUrls, ['https://example.com/weather']);
  assert.match(result.uncertainty.join(' '), /untrusted/u);
  assert.equal(result.suggestedContent, 'ไม่ยืนยันอุณหภูมิจากเครื่องมือ');
});

test('world-intel adapter wraps missing untrusted tags and reports degraded availability', async () => {
  const registry = new CapabilityRegistry();
  registerWorldIntelCapabilities(registry, fakeWorldIntelPort({
    execute: async () => ({ content: 'raw headline', sources: ['https://example.com/raw'] }),
    getStatus: async () => ({ availability: 'not_configured', error: 'world-intel-mcp is not installed' }),
  }));
  const newsId = worldIntelCapabilityId('intel_news_feed');
  const availability = await registry.availability(newsId);
  assert.equal(availability.availability, 'not_configured');
  assert.equal(availability.degraded, true);
  const result = await registry.invoke({ id: newsId, input: {} });
  assert.match(result.content, /^<untrusted_tool_output>raw headline<\/untrusted_tool_output>$/u);
  assert.equal(result.untrustedOutput, true);
  assert.deepEqual(result.sourceUrls, ['https://example.com/raw']);
});

test('Jarvis core, presentation, and capability registry modules do not import MCP or Discord transport', () => {
  const mcpImport = /from\s+['"][^'"]*McpResearchGateway['"]/u;
  const discordImport = /(?:^|\n)import[\s\S]*?from\s+['"](?:discord(?:\.js)?|@discordjs\/)['"]/u;
  const capabilityImport = /from\s+['"][^'"]*capabilities(?:\/[^'"]*)?['"]/u;
  const files = [
    path.join(process.cwd(), 'src', 'jarvis', 'core'),
    path.join(process.cwd(), 'src', 'jarvis', 'capabilities', 'CapabilityRegistry.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'capabilities', 'types.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'standalone', 'LocalLlmJarvisCore.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'presentation'),
  ];
  for (const target of files) {
    const paths = fs.statSync(target).isDirectory()
      ? fs.readdirSync(target).filter(name => name.endsWith('.ts')).map(name => path.join(target, name))
      : [target];
    for (const file of paths) {
      const source = fs.readFileSync(file, 'utf8');
      assert.equal(mcpImport.test(source), false, file);
      assert.equal(discordImport.test(source), false, file);
      if (file.includes(`${path.sep}presentation${path.sep}`) || file.endsWith(`${path.sep}presentation`) || file.includes(`${path.sep}presentation/`)) {
        assert.equal(capabilityImport.test(source), false, file);
      }
    }
  }
});

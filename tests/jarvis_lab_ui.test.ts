import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { LocalLlmJarvisCore } from '../src/jarvis';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';
import {
  actionActivityLabel,
  deriveActivityTimeline,
  deriveLabCorePhase,
  deriveSystemRibbon,
  enrichToolActivity,
  formatConfidence,
  formatLatencyMs,
  formatTurnTimingsLine,
  isExplicitActionConfirmation,
} from '../src/jarvis/ui/labUiState';

test('lab core phase is driven by observable UI state only', () => {
  assert.equal(deriveLabCorePhase({
    busy: true,
    error: null,
    hasResponse: false,
    memoryCount: 0,
    toolCount: 0,
  }), 'thinking');
  assert.equal(deriveLabCorePhase({
    busy: false,
    error: 'nope',
    hasResponse: false,
    memoryCount: 0,
    toolCount: 0,
  }), 'error');
  assert.equal(deriveLabCorePhase({
    busy: false,
    error: null,
    llmReachable: false,
    hasResponse: false,
    memoryCount: 0,
    toolCount: 0,
  }), 'degraded');
  assert.equal(deriveLabCorePhase({
    busy: false,
    error: null,
    llmReachable: true,
    hasResponse: false,
    memoryCount: 0,
    toolCount: 0,
  }), 'idle');
  assert.equal(deriveLabCorePhase({
    busy: false,
    error: null,
    llmReachable: true,
    hasResponse: false,
    memoryCount: 0,
    toolCount: 0,
    micState: 'listening',
  }), 'listening');
  assert.equal(deriveLabCorePhase({
    busy: false,
    error: null,
    llmReachable: true,
    hasResponse: false,
    memoryCount: 0,
    toolCount: 0,
    micState: 'transcribing',
  }), 'transcribing');
  assert.equal(deriveLabCorePhase({
    busy: false,
    error: null,
    llmReachable: true,
    hasResponse: true,
    memoryCount: 0,
    toolCount: 0,
    speechState: 'speaking',
  }), 'speaking');
  assert.equal(deriveLabCorePhase({
    busy: false,
    error: null,
    llmReachable: true,
    hasResponse: true,
    memoryCount: 1,
    toolCount: 0,
  }), 'memory');
  assert.equal(deriveLabCorePhase({
    busy: false,
    error: null,
    llmReachable: true,
    hasResponse: true,
    memoryCount: 0,
    toolCount: 1,
  }), 'tool');
  assert.equal(deriveLabCorePhase({
    busy: false,
    error: null,
    llmReachable: true,
    hasResponse: true,
    memoryCount: 1,
    toolCount: 1,
  }), 'responding');
});

test('unknown status does not invent Qwen offline', () => {
  const ribbon = deriveSystemRibbon({});
  const qwen = ribbon.find(item => item.id === 'qwen');
  assert.equal(qwen?.value, '…');
  assert.equal(qwen?.lit, false);
  const tools = ribbon.find(item => item.id === 'tools');
  assert.equal(tools?.value, '…');
  const local = ribbon.find(item => item.id === 'local');
  assert.equal(local?.lit, true);
});

test('activity timeline stays pending mid-request and never invents tool/memory stages', () => {
  const busy = deriveActivityTimeline({
    busy: true,
    hasResponse: false,
    memoryCount: 0,
    toolCount: 0,
    toolFailed: false,
    hasPresentedText: false,
  });
  assert.equal(busy.find(item => item.id === 'request')?.state, 'active');
  assert.equal(busy.find(item => item.id === 'memory')?.state, 'pending');
  assert.equal(busy.find(item => item.id === 'tool')?.state, 'pending');

  const done = deriveActivityTimeline({
    busy: false,
    hasResponse: true,
    memoryCount: 1,
    toolCount: 1,
    toolFailed: true,
    hasPresentedText: true,
  });
  assert.deepEqual(done.map(item => [item.id, item.state]), [
    ['request', 'done'],
    ['memory', 'done'],
    ['tool', 'failed'],
    ['model', 'done'],
    ['response', 'done'],
  ]);
});

test('tool rail enrichment uses catalog/untrusted summary and does not invent a provider', () => {
  const unknown = enrichToolActivity({ toolName: 'lab.missing', status: 'unavailable', summary: 'not registered' });
  assert.equal(unknown.provider, undefined);
  assert.equal(unknown.untrusted, false);
  assert.equal(unknown.failed, true);

  const world = enrichToolActivity(
    { toolName: 'world-intel.intel_status', status: 'ok', summary: 'untrusted external data', sourceUrls: ['https://example.test'] },
    [{ id: 'world-intel.intel_status', providerKind: 'mcp', untrustedOutput: true }],
  );
  assert.equal(world.provider, 'mcp');
  assert.equal(world.untrusted, true);
  assert.deepEqual(world.sourceUrls, ['https://example.test']);
});

test('confidence and latency formatters skip missing values', () => {
  assert.equal(formatConfidence(0.87), '87%');
  assert.equal(formatConfidence(undefined), null);
  assert.equal(formatLatencyMs(7), '7ms');
  assert.equal(formatLatencyMs(1090), '1.090s');
  assert.equal(formatLatencyMs(null), null);
  assert.equal(formatTurnTimingsLine(null), null);
  assert.match(formatTurnTimingsLine({ totalMs: 12, llmTtftMs: 8 }) || '', /ttft 8ms/);
  assert.match(formatTurnTimingsLine({ totalMs: 900 }, { promptTokens: 40, tokensPerSec: 28.1 }) || '', /28\.1 tok\/s/);
});

test('lab status catalog is descriptor metadata and does not invoke capabilities', async () => {
  let invoked = false;
  const lab = createJarvisLabRuntime({
    attachDefaultMemory: false,
    attachDefaultCapabilities: false,
    attachDefaultPresentation: false,
    capabilities: {
      register() {},
      lookup() { return undefined; },
      list() {
        return [{
          id: 'lab.ping',
          description: 'ping',
          inputSchema: {},
          outputSchema: {},
          sideEffect: 'read',
          requiredService: 'jarvis-lab',
          providerKind: 'local',
          timeoutMs: 1000,
          untrustedOutput: false,
        }];
      },
      availability: async () => ({ id: 'lab.ping', availability: 'up', degraded: false }),
      invoke: async () => {
        invoked = true;
        throw new Error('status must not invoke');
      },
    },
    core: new LocalLlmJarvisCore({ generateText: async () => 'x' }),
    llm: {
      generateText: async () => 'x',
      getRuntimeStatus: async () => ({ enabled: true, reachable: true, model: 'test' }),
    },
  });
  const status = await lab.status();
  assert.equal(status.capabilities.attached, true);
  assert.equal(status.capabilities.catalog[0]?.id, 'lab.ping');
  assert.equal(status.capabilities.catalog[0]?.providerKind, 'local');
  assert.equal(invoked, false);
});

test('action activity labels stay observable and confirmation phrases are explicit', () => {
  assert.equal(actionActivityLabel({ name: 'desktop.openApplication', status: 'confirmation_required' }), 'Permission required');
  assert.equal(actionActivityLabel({ name: 'desktop.openApplication', status: 'denied', summary: 'Action denied' }), 'Action denied');
  assert.equal(isExplicitActionConfirmation('allow once'), true);
  assert.equal(isExplicitActionConfirmation('maybe later'), false);
});

test('jarvis lab page is a command center and stays Discord-free', () => {
  const files = [
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'JarvisLabPage.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'JarvisCoreVisual.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'labUiState.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'browserMicrophone.ts'),
  ];
  const discord = /from\s+['"](?:discord(?:\.js)?|@discordjs\/)['"]/u;
  const page = fs.readFileSync(files[0]!, 'utf8');
  assert.match(page, /jcc-ribbon/);
  assert.match(page, /jcc-memory/);
  assert.match(page, /jcc-tools/);
  assert.match(page, /jcc-timeline/);
  assert.match(page, /jcc-dock/);
  assert.match(page, /toggleMic/);
  assert.match(page, /ask-stream/);
  assert.match(page, /Review the text, then Ask/);
  assert.match(page, /Speak/);
  assert.match(page, /jcc-permit/);
  assert.match(page, /Allow once/);
  assert.match(page, /speak: shouldSpeak/);
  assert.doesNotMatch(page, /Microphone is not enabled yet/);
  assert.doesNotMatch(page, /<select/);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(discord.test(source), false, file);
  }
});

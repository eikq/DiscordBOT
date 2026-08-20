import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ollamaMetricsFromChat } from '../src/bot/llm/ollamaMetrics';
import {
  CommandCenterRuntime,
  FakeNativeJarvisHelper,
  FORBIDDEN_TRACE_KEYS,
  NATIVE_HELPER_PROTOCOL_VERSION,
  applySpokenDuration,
  classifyComparisonIntent,
  parseNativeHelperRequest,
  routeJarvisRequest,
  runPresentationPipeline,
} from '../src/jarvis';
import { capabilityPresentationFacts, mergeCapabilityPresentationFacts } from '../src/jarvis/capabilities/capabilityFacts';
import { CapabilityRegistry } from '../src/jarvis/capabilities/CapabilityRegistry';
import type { CapabilityHost, CapabilityResult } from '../src/jarvis/capabilities/types';
import {
  displayForWindow,
  nativeHelperLogSafe,
  NativeOwnershipRegistry,
  rejectForeignWindowTarget,
  unavailableNativeHelperHealth,
  createJarvisWindowHost,
  JarvisPresenceStore,
} from '../src/jarvis/desktop';
import type { DisplayInfo } from '../src/jarvis/desktop';
import { applyOwnerDisplayNames, resolveDisplaySelector } from '../src/jarvis/desktop/displayNames';
import { playbackAtElapsed, repeatPlayback, backPlayback, spokenSequenceFrom } from '../src/jarvis/presentation/briefing/playback';
import { classifyPresenterAuthority } from '../src/jarvis/presentation/briefing/authority';
import { buildMotionTimeline } from '../src/jarvis/presentation/briefing/motion';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function result(id: string, extra: Partial<CapabilityResult> = {}): CapabilityResult {
  return {
    capabilityId: id,
    status: 'ok',
    structured: extra.structured ?? { ok: true },
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
        sideEffect: 'read',
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

const GAP_DISPLAYS: DisplayInfo[] = [
  {
    id: '\\\\.\\DISPLAY1',
    name: 'DISPLAY1',
    aliases: ['1'],
    primary: false,
    bounds: { x: -3840, y: 0, width: 1920, height: 1080 },
    workingArea: { x: -3840, y: 0, width: 1920, height: 1040 },
    ownerNamed: false,
  },
  {
    id: '\\\\.\\DISPLAY5',
    name: 'DISPLAY5',
    aliases: ['5'],
    primary: true,
    bounds: { x: 0, y: 0, width: 2560, height: 1440 },
    workingArea: { x: 0, y: 0, width: 2560, height: 1400 },
    ownerNamed: false,
  },
];

test('structured system.status facts become CPU/RAM/Disk/GPU cards and omit missing GPU', () => {
  const withGpu = runPresentationPipeline({
    text: 'สถานะระบบ',
    route: 'CAPABILITY',
    capabilityId: 'system.status',
    systemSnapshot: {
      summary: 'CPU 17% · RAM 46%',
      cpu: { usagePct: 17, cores: 32 },
      ram: { usedPct: 46, freeMb: 32000 },
      disk: { freeGb: 412 },
      gpu: { name: 'RTX 5090 Laptop', utilizationPct: 12 },
    },
  });
  assert.notEqual(withGpu.density, 'plain');
  if (withGpu.density === 'plain') return;
  assert.ok(withGpu.cards.some(item => item.id === 'system.cpu'));
  assert.ok(withGpu.cards.some(item => item.id === 'system.memory'));
  assert.ok(withGpu.cards.some(item => item.id === 'system.disk'));
  assert.ok(withGpu.cards.some(item => item.id === 'system.gpu'));
  assert.equal(withGpu.cards.some(item => item.title === 'Telemetry'), false);
  const noGpu = runPresentationPipeline({
    text: 'สถานะระบบ',
    route: 'CAPABILITY',
    capabilityId: 'system.status',
    systemSnapshot: {
      cpu: { usagePct: 10, cores: 8 },
      ram: { usedPct: 40, freeMb: 1000 },
    },
  });
  assert.notEqual(noGpu.density, 'plain');
  if (noGpu.density === 'plain') return;
  assert.equal(noGpu.cards.some(item => item.id === 'system.gpu'), false);
});

test('structured display results keep the real count instead of 0 displays', () => {
  const planned = runPresentationPipeline({
    text: 'มีกี่จอ',
    route: 'CAPABILITY',
    capabilityId: 'desktop.listDisplays',
    displays: {
      count: 2,
      ids: ['\\\\.\\DISPLAY1', '\\\\.\\DISPLAY5'],
      names: ['DISPLAY1', 'DISPLAY5'],
      hostKind: 'browser',
    },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  assert.match(planned.summary, /2 displays/u);
  assert.equal(planned.summary.includes('0 display'), false);
  assert.ok(planned.cards.some(item => item.id === 'desktop.displays' && item.body.includes('2 display')));
});

test('stale research does not bleed into a later diagnostic briefing model', () => {
  const leftover = {
    query: 'old research',
    synthesis: 'Old Qwen sources.',
    sources: [
      { sourceId: 'src-old', title: 'Old', url: 'https://old.example' },
      { sourceId: 'src-old-2', title: 'Older', url: 'https://older.example' },
    ],
    evidence: [{ evidenceId: 'ev-old', claim: 'stale', sourceId: 'src-old' }],
  };
  const planned = runPresentationPipeline({
    text: 'สถานะระบบ',
    route: 'CAPABILITY',
    capabilityId: 'system.status',
    research: leftover,
    systemSnapshot: { cpu: { usagePct: 21, cores: 16 }, ram: { usedPct: 33, freeMb: 8000 } },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  assert.equal(planned.evidence.some(item => item.id.startsWith('src-old')), false);
  assert.equal(JSON.stringify(planned).includes('old.example'), false);
  assert.ok(planned.cards.some(item => item.id === 'system.cpu'));
});

test('narration timeline scales to actual speech duration and advances by segment', () => {
  const planned = runPresentationPipeline({
    text: 'สถานะระบบ',
    capabilityId: 'system.status',
    systemSnapshot: {
      cpu: { usagePct: 11, cores: 8 },
      ram: { usedPct: 22, freeMb: 4000 },
      gpu: { name: 'GPU A', utilizationPct: 9 },
    },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  const scaled = applySpokenDuration(planned, 4000);
  const total = scaled.narrationSegments.reduce((sum, item) => sum + item.estimatedMs, 0);
  assert.ok(Math.abs(total - 4000) < 200);
  const mid = playbackAtElapsed(scaled.id, scaled.narrationSegments, 1500, { actualSpeechDurationMs: 4000 });
  assert.ok(mid.segmentIndex >= 0);
  assert.equal(mid.pauseSupported, false);
  const spoken = spokenSequenceFrom(scaled);
  assert.ok(spoken.includes('That is the briefing'));
  assert.match(spoken, /CPU|GPU|Memory/u);
});

test('repeat and back restore visual focus without minting a tool call', () => {
  const planned = runPresentationPipeline({
    text: 'สถานะระบบ',
    capabilityId: 'system.status',
    systemSnapshot: { cpu: { usagePct: 8, cores: 8 }, ram: { usedPct: 30, freeMb: 2000 } },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  const later = playbackAtElapsed(planned.id, planned.narrationSegments, 2500);
  const playing = { ...planned, playback: later };
  const repeated = repeatPlayback(playing);
  assert.equal(repeated.playback.segmentIndex, later.segmentIndex);
  assert.ok(repeated.motionTimeline.some(item => item.action === 'focus' && item.target.id === later.targetId));
  const backed = backPlayback(repeated);
  assert.ok(backed.playback.segmentIndex <= repeated.playback.segmentIndex);
  assert.equal(classifyPresenterAuthority('repeat', planned).kind, 'local');
  assert.equal(classifyPresenterAuthority('back', planned).kind, 'local');
  assert.equal(classifyPresenterAuthority('compare the latest Qwen docs').kind, 'route');
});

test('monitor intersection selects the overlapping display; gaps stay UNKNOWN_DISPLAY', () => {
  const onLeft = displayForWindow(GAP_DISPLAYS, { x: -3600, y: 40, width: 1400, height: 900 });
  assert.equal(onLeft?.id, '\\\\.\\DISPLAY1');
  const onRight = displayForWindow(GAP_DISPLAYS, { x: 80, y: 40, width: 1400, height: 900 });
  assert.equal(onRight?.id, '\\\\.\\DISPLAY5');
  const inGap = displayForWindow(GAP_DISPLAYS, { x: -1920, y: 0, width: 1400, height: 900 });
  assert.equal(inGap, undefined);
  const negativeInside = displayForWindow(GAP_DISPLAYS, { x: -3000, y: 10, width: 800, height: 700 });
  assert.equal(negativeInside?.id, '\\\\.\\DISPLAY1');
});

test('owner display aliases resolve notebook/main only after a current named display exists', () => {
  const named = applyOwnerDisplayNames(GAP_DISPLAYS, [
    { id: '\\\\.\\DISPLAY1', name: 'notebook', aliases: ['laptop', 'จอโน้ตบุ๊ก'] },
    { id: '\\\\.\\DISPLAY5', name: 'main', aliases: ['จอหลัก'] },
  ]);
  const notebook = resolveDisplaySelector(named, { role: 'notebook' });
  assert.equal(notebook.ok && notebook.display.name, 'notebook');
  const main = resolveDisplaySelector(named, { role: 'main' });
  assert.equal(main.ok && main.display.id, '\\\\.\\DISPLAY5');
  const missing = resolveDisplaySelector(GAP_DISPLAYS, { role: 'main' });
  assert.equal(missing.ok, false);
});

test('native helper rejects HWND/process targeting and fail-closes when unavailable', () => {
  const health = unavailableNativeHelperHealth();
  assert.equal(health.installed, false);
  assert.equal(health.reasonCode, 'UNSUPPORTED_HOST');
  const hwnd = parseNativeHelperRequest({
    protocolVersion: NATIVE_HELPER_PROTOCOL_VERSION,
    command: 'MOVE',
    windowId: 'pres-1',
    hwnd: '0x1234',
  });
  assert.equal(hwnd.ok, false);
  if (!hwnd.ok) assert.equal(hwnd.reasonCode, 'FORBIDDEN_ARGUMENT');
  assert.equal(rejectForeignWindowTarget({ processName: 'chrome.exe' }), 'INVALID_TARGET');
  const helper = new FakeNativeJarvisHelper({ available: false, runtimeId: 'rt-1', sessionId: 'sess-1' });
  const closed = helper.handle({ protocolVersion: NATIVE_HELPER_PROTOCOL_VERSION, command: 'HEALTH' });
  assert.equal(closed.ok, false);
  assert.equal(closed.reasonCode, 'UNSUPPORTED_HOST');
});

test('CONTROL and PRESENTER belong to one runtime; ownership is enforced', async () => {
  const helper = new FakeNativeJarvisHelper({ available: true, runtimeId: 'rt-1', sessionId: 'sess-1' });
  helper.registerOwned('ctrl-1', 'CONTROL', { x: 0, y: 0, width: 800, height: 600 });
  helper.registerOwned('pres-1', 'PRESENTER', { x: 10, y: 10, width: 1200, height: 800 });
  assert.equal(helper.ownership.sameRuntime('rt-1', 'sess-1'), true);
  assert.equal(helper.ownership.list().every(item => item.runtimeId === 'rt-1' && item.sessionId === 'sess-1'), true);
  const adapter = helper.adapter();
  const moved = await adapter.moveOwnedWindow!({
    windowId: 'pres-1',
    bounds: { x: 100, y: 40, width: 1200, height: 800 },
  });
  assert.equal(moved.status, 'moved');
  const foreign = await adapter.moveOwnedWindow!({
    windowId: 'chrome-hwnd',
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  });
  assert.equal(foreign.reasonCode, 'INVALID_TARGET');
  const registry = new NativeOwnershipRegistry('rt-1', 'sess-1');
  registry.register('pres-1', 'PRESENTER');
  const required = registry.requireOwned('not-ours');
  assert.equal('ok' in required && required.ok === false, true);
});

test('comparison intent does not send every compare to web research', () => {
  assert.equal(classifyComparisonIntent('compare those two sources'), 'supplied_data');
  assert.equal(routeJarvisRequest({ text: 'compare those two sources' }).route, 'INFORMATION');
  assert.equal(routeJarvisRequest({ text: 'compare those two sources' }).agentic, false);
  assert.equal(classifyComparisonIntent('compare the latest Qwen documentation'), 'needs_external_facts');
  assert.equal(routeJarvisRequest({ text: 'compare the latest Qwen documentation' }).route, 'RESEARCH');
  assert.equal(routeJarvisRequest({ text: 'research the latest Qwen documentation' }).route, 'RESEARCH');
  assert.equal(routeJarvisRequest({ text: 'hello' }).route, 'CONVERSATION');
});

test('presenter and native telemetry omit secrets, CoT, and helper tokens', () => {
  const planned = runPresentationPipeline({
    text: 'สถานะระบบ',
    capabilityId: 'system.status',
    replyText: 'CPU 12%',
    systemSnapshot: { cpu: { usagePct: 12, cores: 8 }, ram: { usedPct: 20, freeMb: 1000 } },
  });
  const blob = JSON.stringify(planned);
  for (const key of FORBIDDEN_TRACE_KEYS) {
    assert.equal(blob.includes(`"${key}"`), false, key);
  }
  const logged = nativeHelperLogSafe({
    command: 'MOVE',
    token: 'secret-owner-token',
    confirmToken: 'confirm',
    windowId: 'pres-1',
  });
  assert.equal(JSON.stringify(logged).includes('secret-owner-token'), false);
  assert.equal((logged as { windowId?: string }).windowId, 'pres-1');
});

test('capability facts copy typed snapshots rather than leftover prose', () => {
  const facts = capabilityPresentationFacts('system.status', {
    snapshot: {
      cpu: { usagePct: 5, cores: 4 },
      ram: { usedPct: 10, freeMb: 100, totalMb: 1000 },
      disk: { freeGb: 20, totalGb: 100 },
    },
  }, 'CPU 5%');
  const displays = capabilityPresentationFacts('desktop.listDisplays', {
    hostKind: 'browser',
    displays: [
      { id: '\\\\.\\DISPLAY1', name: 'DISPLAY1' },
      { id: '\\\\.\\DISPLAY5', name: 'DISPLAY5' },
    ],
  });
  const merged = mergeCapabilityPresentationFacts([facts, displays]);
  assert.equal(merged.systemSnapshot?.cpu?.usagePct, 5);
  assert.equal(merged.displays?.count, 2);
  assert.deepEqual(merged.displays?.ids, ['\\\\.\\DISPLAY1', '\\\\.\\DISPLAY5']);
});

test('lab runtime briefing uses this-turn system.status structured result', async () => {
  const host = testHost({
    'system.status': () => result('system.status', {
      content: 'CPU 19% · RAM 41% · Disk 100 GB free · GPU RTX Test 3%',
      structured: {
        status: 'completed',
        risk: 'READ_ONLY',
        snapshot: {
          cpu: { usagePct: 19, cores: 16 },
          ram: { usedPct: 41, freeMb: 22000, totalMb: 64000 },
          disk: { freeGb: 100, totalGb: 512 },
          gpu: { name: 'RTX Test', utilizationPct: 3 },
        },
      },
    }),
    'desktop.listDisplays': () => result('desktop.listDisplays', {
      content: '2 displays visible.',
      structured: {
        status: 'completed',
        risk: 'READ_ONLY',
        hostKind: 'browser',
        displays: [
          { id: '\\\\.\\DISPLAY1', name: 'DISPLAY1' },
          { id: '\\\\.\\DISPLAY5', name: 'DISPLAY5' },
        ],
      },
    }),
    'research.search': () => result('research.search', {
      content: 'stale',
      untrustedOutput: true,
      structured: { risk: 'READ_ONLY' },
    }),
  });
  const center = new CommandCenterRuntime({
    host,
    persistRoot: tempRoot('jarvis-pdc-'),
  });
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
    llm: { generateText: async () => 'Diagnostic reply.' },
  });
  await lab.ask({ text: 'research the latest Qwen documentation', sessionId: 'pdc' });
  const status = await lab.ask({ text: 'สถานะระบบ', sessionId: 'pdc' });
  if (!status.briefing || status.briefing.density === 'plain') {
    assert.fail('expected rich diagnostic briefing');
    return;
  }
  assert.equal(JSON.stringify(status.briefing).includes('qwen.readthedocs'), false);
  assert.ok(status.briefing.cards.some(item => item.id === 'system.cpu' && item.body.includes('19%')));
  assert.ok(status.briefing.cards.some(item => item.id === 'system.gpu'));
  const listed = await lab.ask({ text: 'มีกี่จอ', sessionId: 'pdc' });
  if (!listed.briefing || listed.briefing.density === 'plain') {
    assert.fail('expected rich display briefing');
    return;
  }
  assert.match(listed.briefing.summary, /2 displays/u);
  center.agent.store.close();
  center.persistence?.close();
});

test('ask metrics keep the model name when Ollama reports it', () => {
  const metrics = ollamaMetricsFromChat({
    model: 'digital-me-qwen38:27b-ad-q4km',
    eval_count: 8,
    eval_duration: 1_000_000_000,
  });
  assert.equal(metrics.model, 'digital-me-qwen38:27b-ad-q4km');
});

test('reduced motion keeps focus/highlight and skips pulse/zoom after speech scaling', () => {
  const planned = runPresentationPipeline({
    text: 'สถานะระบบ',
    capabilityId: 'system.status',
    systemSnapshot: { cpu: { usagePct: 4, cores: 8 }, ram: { usedPct: 20, freeMb: 1000 } },
  }, { reducedMotion: true, spokenMs: 3000 });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  assert.equal(planned.motionTimeline.some(item => item.action === 'pulse' || item.action === 'zoom'), false);
  assert.ok(planned.motionTimeline.some(item => item.action === 'focus'));
  const pulseSegments = [{
    id: 'narr-node',
    order: 0,
    text: 'Graph',
    kind: 'section' as const,
    target: { type: 'graph-node' as const, id: 'node-1' },
    estimatedMs: 1200,
  }];
  assert.equal(buildMotionTimeline(pulseSegments, { reducedMotion: true }).some(item => item.action === 'pulse'), false);
});

test('browser host window mutations stay UNSUPPORTED_HOST', async () => {
  const presence = new JarvisPresenceStore();
  presence.reportClientWindow({ screenX: 80, screenY: 40, outerWidth: 1400, outerHeight: 900 });
  const host = createJarvisWindowHost({
    presence,
    hostKind: 'browser',
    enumerateDisplays: async () => GAP_DISPLAYS,
  });
  const moved = await host.moveJarvisWindow({ index: 2 });
  assert.equal(moved.reasonCode, 'UNSUPPORTED_HOST');
  const focused = await host.focusJarvisWindow();
  assert.equal(focused.reasonCode, 'UNSUPPORTED_HOST');
  const listed = await host.listDisplays();
  assert.equal(listed.status, 'ok');
  assert.equal(listed.displays.length, 2);
});

test('window reports in a monitor gap stay UNKNOWN_DISPLAY', () => {
  const presence = new JarvisPresenceStore();
  presence.reportClientWindow({ screenX: -1920, screenY: 0, outerWidth: 1400, outerHeight: 900 });
  const window = presence.windowFromReport(GAP_DISPLAYS, 'browser');
  assert.equal(window.available, true);
  assert.equal(window.displayId, undefined);
  assert.equal(window.reasonCode, 'UNKNOWN_DISPLAY');
});

test('get-window facts with count 0 do not produce a 0 displays briefing', () => {
  const planned = runPresentationPipeline({
    text: 'อยู่จอไหน',
    route: 'CAPABILITY',
    capabilityId: 'desktop.getJarvisWindow',
    displays: {
      count: 0,
      ids: [],
      currentName: 'DISPLAY5',
      currentId: '\\\\.\\DISPLAY5',
      hostKind: 'browser',
    },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  assert.equal(planned.summary.includes('0 display'), false);
  assert.match(planned.summary, /DISPLAY5/u);
});

test('compare without research stays off the web-research route unless new facts are needed', () => {
  assert.equal(routeJarvisRequest({ text: 'compare Qwen and Llama' }).route, 'INFORMATION');
  assert.equal(routeJarvisRequest({ text: 'compare Qwen and Llama' }).agentic, false);
  assert.notEqual(routeJarvisRequest({ text: 'compare Qwen and Llama' }).route, 'RESEARCH');
  assert.equal(routeJarvisRequest({ text: 'compare those two sources' }).reason, 'compare_supplied_data');
});

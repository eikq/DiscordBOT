import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { derivePipelineStages, type LabCorePhase } from '../src/jarvis/ui/labUiState';
import { formatAgo, formatMb, formatPct, matchToolNodeId } from '../src/jarvis/ui/labViewModels';
import { PulseBus } from '../src/jarvis/ui/three/pulseBus';
import {
  clampDpr,
  nextAutoQuality,
  parseQualityMode,
  qualityPreset,
  resolveQualityLevel,
} from '../src/jarvis/ui/three/quality';
import { hexToRgb, sceneMoodFor } from '../src/jarvis/ui/three/sceneState';
import {
  scheduleWebglLossCheck,
  webglAvailable,
} from '../src/jarvis/ui/three/webglAvailability';
import { nightAgentSnapshot, systemHealthSnapshot } from '../src/jarvis/standalone/labSystem';

const ALL_PHASES: LabCorePhase[] = [
  'idle', 'listening', 'transcribing', 'thinking', 'memory', 'tool',
  'responding', 'speaking', 'degraded', 'error',
];

test('scene mood maps every observable phase without inventing state', () => {
  for (const phase of ALL_PHASES) {
    const mood = sceneMoodFor(phase);
    assert.equal(mood.phase, phase);
    assert.match(mood.primary, /^#/);
    assert.ok(mood.particleSpeed > 0);
    assert.ok(mood.dim > 0 && mood.dim <= 1);
  }
  const idle = sceneMoodFor('idle');
  assert.equal(idle.accent, '#38bdf8', 'idle keeps cyan as the primary accent');
  const thinking = sceneMoodFor('thinking');
  assert.ok(thinking.contract > idle.contract, 'thinking contracts energy toward the nucleus');
  assert.ok(thinking.particleSpeed > idle.particleSpeed, 'thinking accelerates particles');
  assert.equal(sceneMoodFor('speaking').pulse, 'speaking');
  assert.equal(sceneMoodFor('listening').pulse, 'listening');
  assert.ok(sceneMoodFor('degraded').dim < 1, 'degraded dims the scene');
  assert.notEqual(sceneMoodFor('error').primary, idle.primary);
  const night = sceneMoodFor('idle', { nightActive: true });
  assert.equal(night.nightActive, true);
  assert.equal(night.primary, '#a78bfa', 'night agent tints idle violet');
  const nightThinking = sceneMoodFor('thinking', { nightActive: true });
  assert.equal(nightThinking.primary, sceneMoodFor('thinking').primary, 'live phases outrank night tint');
});

test('hexToRgb parses colors and tolerates junk', () => {
  assert.deepEqual(hexToRgb('#ffffff'), [1, 1, 1]);
  const [r, g, b] = hexToRgb('#7dd3fc');
  assert.ok(r > 0.4 && g > 0.8 && b > 0.95);
  assert.deepEqual(hexToRgb('#fff'), [1, 1, 1]);
  assert.deepEqual(hexToRgb('not-a-color'), [1, 1, 1]);
});

test('WebGL availability checks browser APIs without allocating a GPU context', () => {
  assert.equal(webglAvailable({ WebGL2RenderingContext: class {} }), true);
  assert.equal(webglAvailable({ WebGLRenderingContext: class {} }), true);
  assert.equal(webglAvailable({}), false);
});

test('intentional Canvas unmount does not report a WebGL loss', () => {
  let callback: (() => void) | undefined;
  let losses = 0;
  const canvas = { isConnected: true };
  scheduleWebglLossCheck(canvas, () => { losses += 1; }, next => { callback = next; });
  canvas.isConnected = false;
  callback?.();
  assert.equal(losses, 0);

  canvas.isConnected = true;
  let generation = 1;
  scheduleWebglLossCheck(
    canvas,
    () => { losses += 1; },
    next => { callback = next; },
    () => generation === 1,
  );
  generation = 2;
  callback?.();
  assert.equal(losses, 0, 'StrictMode effect replacement invalidates the stale loss event');

  scheduleWebglLossCheck(canvas, () => { losses += 1; }, next => { callback = next; });
  callback?.();
  assert.equal(losses, 1, 'a connected Canvas still reports a real context loss');
});

test('quality presets scale down and auto stepping is bounded', () => {
  const high = qualityPreset('high');
  const balanced = qualityPreset('balanced');
  const minimal = qualityPreset('minimal');
  assert.ok(high.particleCount > balanced.particleCount && balanced.particleCount > minimal.particleCount);
  assert.ok(
    high.cognitionPointCount > balanced.cognitionPointCount
      && balanced.cognitionPointCount > minimal.cognitionPointCount,
    'localized cognition concentrations scale down with quality',
  );
  assert.ok(high.dprCap > balanced.dprCap && balanced.dprCap > minimal.dprCap);
  assert.equal(minimal.ringTicks, 0);

  assert.equal(nextAutoQuality('high', 30), 'balanced');
  assert.equal(nextAutoQuality('balanced', 30), 'minimal');
  assert.equal(nextAutoQuality('minimal', 30), null, 'minimal never drops further');
  assert.equal(nextAutoQuality('minimal', 60), 'balanced');
  assert.equal(nextAutoQuality('balanced', 60), 'high');
  assert.equal(nextAutoQuality('high', 60), null);
  assert.equal(nextAutoQuality('high', 50), null, 'steady band holds current level');
  assert.equal(nextAutoQuality('high', Number.NaN), null);

  assert.equal(clampDpr(3, high), high.dprCap);
  assert.equal(clampDpr(1, high), 1);
  assert.equal(clampDpr(Number.NaN, minimal), 1);

  assert.equal(parseQualityMode('balanced'), 'balanced');
  assert.equal(parseQualityMode('2d'), '2d');
  assert.equal(parseQualityMode('junk'), 'auto');
  assert.equal(resolveQualityLevel('auto', 'balanced'), 'balanced');
  assert.equal(resolveQualityLevel('minimal', 'high'), 'minimal');
  assert.equal(resolveQualityLevel('2d', 'high'), '2d');
});

test('Blender hero GLBs exist on the R3F import path', () => {
  const exportDir = path.join(process.cwd(), 'assets', 'jarvis', 'blender', 'export');
  const files = [
    'jarvis_core_cage.glb',
    'jarvis_scanner_arc.glb',
    'jarvis_hud_ring.glb',
    'jarvis_radial_segment.glb',
  ];
  for (const file of files) {
    const full = path.join(exportDir, file);
    assert.equal(fs.existsSync(full), true, full);
    assert.ok(fs.statSync(full).size > 4000, `${file} should contain modeled geometry`);
  }
  const scene = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'three', 'CoreScene.tsx'), 'utf8');
  assert.match(scene, /jarvis_core_cage\.glb/);
  assert.match(scene, /jarvis_scanner_arc\.glb/);
  assert.match(scene, /jarvis_hud_ring\.glb/);
  assert.match(scene, /jarvis_radial_segment\.glb/);
  assert.match(scene, /GLTFLoader/);
  assert.match(scene, /JCC_RadialMechanicalSegment/);
});

test('pulse bus delivers observable events and unsubscribes cleanly', () => {
  const bus = new PulseBus();
  const seen: string[] = [];
  const unsubscribe = bus.subscribe(pulse => seen.push(pulse.kind));
  bus.emit({ kind: 'memory', nodeIds: ['fact:a'] });
  bus.emit({ kind: 'tool', toolIds: ['lab.ping'] });
  unsubscribe();
  bus.emit({ kind: 'response' });
  assert.deepEqual(seen, ['memory', 'tool']);
  assert.equal(bus.listenerCount(), 0);
});

test('command pipeline covers presentation and speech from real evidence', () => {
  const busyStages = derivePipelineStages({
    busy: true,
    hasResponse: false,
    memoryCount: 0,
    toolCount: 0,
    toolFailed: false,
    hasPresentedText: false,
    speech: 'off',
  });
  assert.deepEqual(busyStages.map(stage => stage.id), ['request', 'memory', 'tool', 'model', 'presentation', 'speech']);
  assert.equal(busyStages[0]?.state, 'active');
  assert.ok(busyStages.slice(1).every(stage => stage.state === 'pending'));

  const spoken = derivePipelineStages({
    busy: false,
    hasResponse: true,
    memoryCount: 1,
    toolCount: 0,
    toolFailed: false,
    hasPresentedText: true,
    speech: 'spoken',
  });
  assert.equal(spoken.find(stage => stage.id === 'presentation')?.state, 'done');
  assert.equal(spoken.find(stage => stage.id === 'speech')?.state, 'done');
  assert.equal(spoken.find(stage => stage.id === 'tool')?.state, 'empty');

  const silent = derivePipelineStages({
    busy: false,
    hasResponse: true,
    memoryCount: 0,
    toolCount: 1,
    toolFailed: true,
    hasPresentedText: true,
    speech: 'off',
  });
  assert.equal(silent.find(stage => stage.id === 'speech')?.state, 'empty');
  assert.equal(silent.find(stage => stage.id === 'tool')?.state, 'failed');

  const failedSpeech = derivePipelineStages({
    busy: false,
    hasResponse: true,
    memoryCount: 0,
    toolCount: 0,
    toolFailed: false,
    hasPresentedText: true,
    speech: 'failed',
  });
  assert.equal(failedSpeech.find(stage => stage.id === 'speech')?.state, 'failed');
});

test('tool node matching uses registry ids only', () => {
  assert.equal(matchToolNodeId('lab.ping', ['lab.ping', 'world-intel.intel_status']), 'lab.ping');
  assert.equal(matchToolNodeId('world-intel.intel_status.run', ['world-intel.intel_status']), 'world-intel.intel_status');
  assert.equal(matchToolNodeId('unknown.tool', ['lab.ping']), null);
});

test('view formatters never invent values', () => {
  assert.equal(formatMb(undefined), 'unknown');
  assert.equal(formatMb(512), '512 MB');
  assert.equal(formatMb(2048), '2.0 GB');
  assert.equal(formatPct(undefined), '—');
  assert.equal(formatPct(42.4), '42%');
  assert.equal(formatAgo(undefined), '');
  assert.equal(formatAgo(Date.now() - 30_000), 'just now');
  assert.match(formatAgo(Date.now() - 120_000), /m ago$/);
});

test('night agent snapshot reads real state files and reports absence honestly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-night-view-'));
  try {
    const missing = nightAgentSnapshot(root);
    assert.equal(missing.available, false);
    assert.ok(missing.reason);

    const stateDir = path.join(root, '.agent', 'night');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'state.json'), JSON.stringify({
      runId: 'run-1',
      status: 'completed',
      startedAt: '2026-08-18T22:28:20.833Z',
      endedAt: '2026-08-18T22:36:13.250Z',
      updatedAt: '2026-08-18T22:36:13.251Z',
      workspaceRoot: root,
      currentTaskId: 'NIGHT-006',
      tasks: {
        'NIGHT-001': { taskId: 'NIGHT-001', title: 'a', status: 'PASS', attempts: [{}], filesChanged: ['x.ts'] },
        'NIGHT-002': { taskId: 'NIGHT-002', title: 'b', status: 'BLOCKED_PROVIDER', attempts: [{}, {}], filesChanged: [] },
      },
    }), 'utf8');
    const snapshot = nightAgentSnapshot(root);
    assert.equal(snapshot.available, true);
    assert.equal(snapshot.status, 'completed');
    assert.equal(snapshot.counts?.total, 2);
    assert.equal(snapshot.counts?.pass, 1);
    assert.equal(snapshot.counts?.blocked, 1);
    assert.equal(snapshot.tasks?.[0]?.attempts, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('system health reports real host data and marks unknowns', async () => {
  const first = await systemHealthSnapshot();
  assert.ok(first.ram && first.ram.totalMb > 0);
  assert.ok(first.process.rssMb > 0);
  const second = await systemHealthSnapshot();
  assert.ok(second.cpu === undefined || (second.cpu.usagePct >= 0 && second.cpu.usagePct <= 100));
  assert.ok(second.gpu !== undefined || typeof second.gpuUnavailableReason === 'string');
});

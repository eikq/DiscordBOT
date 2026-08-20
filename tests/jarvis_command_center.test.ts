import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommandCenterRuntime,
  OwnerControl,
  ProactiveMonitor,
  SimulatedDeviceProvider,
  SimulatedVisionAnalyzer,
  applyOwnerControl,
  parseControlPatch,
  parseDemoScenario,
  parseTaskId,
  presentCommandCenter,
  visionActionAllowed,
} from '../src/jarvis';
import { liveOpsSteps, sourceGraphLayout, systemNodeState } from '../src/jarvis/ui/operationsView';
import { mayPerformVisionAction } from '../src/jarvis/vision/policy';
import { planResearchDepth } from '../src/jarvis/research/private/depth';
import { isStaleKnowledge, knowledgeTtlClass } from '../src/jarvis/research/staleness';
import { buildEvidenceGraph } from '../src/jarvis/research/evidenceGraph';
import { applyBargeIn, applySpeechCancel } from '../src/jarvis/speech/contracts';
import { syndicateGroups } from '../src/jarvis/research/sourceRanker';
import type { SourceRecord } from '../src/jarvis/research/types';

test('vision see is not click, type, or submit', async () => {
  const analyzer = new SimulatedVisionAnalyzer();
  const context = await analyzer.analyze('login_form');
  assert.equal(context.simulated, true);
  assert.ok(context.elements.some(item => item.sensitive));
  const allowed = visionActionAllowed(true, false, false, false);
  assert.equal(allowed.see, true);
  assert.equal(allowed.click, false);
  assert.equal(allowed.submit, false);
  assert.equal(mayPerformVisionAction('click', 'denied'), false);
  assert.equal(mayPerformVisionAction('see', 'unknown'), true);
});

test('proactive monitor cooldown, quiet hours, and aggregation', () => {
  let now = Date.parse('2026-08-19T23:30:00.000Z');
  const monitor = new ProactiveMonitor({
    quietHours: { startHour: 23, endHour: 7 },
    minSeverity: 'warning',
    cooldownMs: 60_000,
  }, () => now);
  const signal = {
    id: 'gpu',
    type: 'temperature' as const,
    summary: 'GPU hot',
    severity: 'warning' as const,
    at: new Date(now).toISOString(),
    ownerRelevant: true,
    simulated: true,
  };
  assert.equal(monitor.ingest(signal), 'aggregate');
  now = Date.parse('2026-08-20T08:00:00.000Z');
  assert.equal(monitor.ingest({ ...signal, severity: 'critical' }), 'notify');
  assert.equal(monitor.ingest({ ...signal, severity: 'critical' }), 'ignore');
  now += 61_000;
  assert.equal(monitor.ingest({ ...signal, severity: 'critical' }), 'notify');
  assert.equal(monitor.ingest({ ...signal, ownerRelevant: false }), 'ignore');
});

test('device VIEW is not CONTROL/CONFIGURE/ADMIN', () => {
  const devices = new SimulatedDeviceProvider();
  const camera = devices.list().find(item => item.kind === 'cctv');
  assert.ok(camera?.simulated);
  assert.equal(devices.capability(camera!.id, 'VIEW'), true);
  assert.equal(devices.capability(camera!.id, 'CONFIGURE'), false);
  assert.equal(devices.capability(camera!.id, 'CONTROL'), false);
});

test('owner controls autonomy; Jarvis cannot raise it', () => {
  const control = new OwnerControl();
  assert.throws(() => control.setMaxAutonomy(5, 'jarvis'));
  control.setMaxAutonomy(3, 'owner');
  assert.throws(() => control.setCurrentAutonomy(3, 'jarvis'));
  const next = control.setCurrentAutonomy(2, 'owner');
  assert.equal(next.currentAutonomy, 2);
  assert.equal(next.maxAutonomy, 3);
});

test('research none depth, staleness, and syndicate grouping', () => {
  const none = planResearchDepth('current GPU', 'none');
  assert.deepEqual(none.queries, []);
  assert.equal(none.maxFetches, 0);
  assert.equal(knowledgeTtlClass('GPU spec'), 'slow');
  assert.equal(isStaleKnowledge(new Date(Date.now() - 2 * 86_400_000).toISOString(), 'product price'), true);
  const sources: SourceRecord[] = [
    source('src_aaaaaaaaaaaa', 'Same Story About Drivers'),
    source('src_bbbbbbbbbbbb', 'Same Story About Drivers'),
  ];
  assert.deepEqual(syndicateGroups(sources), [['src_aaaaaaaaaaaa', 'src_bbbbbbbbbbbb']]);
  const graph = buildEvidenceGraph(sources, [{
    evidenceId: 'evd_aaaaaaaaaaaa',
    sourceId: 'src_aaaaaaaaaaaa',
    claim: 'Driver is current',
    excerpt: 'Official notes',
    location: null,
    confidence: 0.7,
    publishedAt: null,
    fetchedAt: null,
    kind: 'SOURCE_SUPPORTED',
  }]);
  assert.ok(graph.nodes.some(node => node.kind === 'claim'));
  assert.ok(graph.edges.some(edge => edge.relation === 'from_source'));
});

test('speech barge-in cancels the current turn', () => {
  const spoken = { turnId: 't1', phase: 'speaking' as const, cancelled: false, bargeIn: false };
  assert.equal(applySpeechCancel(spoken).phase, 'cancelled');
  assert.equal(applyBargeIn(spoken).bargeIn, true);
});

test('command center demos are tagged simulation and failure does not become success', async () => {
  const center = new CommandCenterRuntime({ simulated: true });
  const research = await center.runDemo('research');
  assert.equal(research.simulationMode, true);
  assert.ok(research.operations.some(event => event.simulated === true));
  const evolution = await center.runDemo('evolution');
  const failed = evolution.evolution.candidates.find(item => item.status === 'FAILED');
  const promo = evolution.evolution.candidates.find(item => item.status === 'PROMOTION_CANDIDATE');
  assert.ok(failed);
  assert.ok(promo);
  assert.equal(center.candidates.productionPromotionAllowed(), false);
  const monitoring = await center.runDemo('monitoring');
  assert.ok(monitoring.notifications.some(item => item.simulated === true));
  await center.simulateVision('error_dialog');
  assert.equal(center.snapshot().vision?.simulated, true);
  const presented = presentCommandCenter(center.snapshot(), () => Date.parse('2099-01-01T00:00:00.000Z'));
  assert.equal(presented.simulationMode, true);
  assert.equal(presented.fresh, false);
  assert.equal(presented.evolution.productionPromotionAllowed, false);
  assert.ok(presented.devices.every(item => item.simulated));
});

test('command-center HTTP parsers stay fail-closed', () => {
  assert.equal(parseDemoScenario('research'), 'research');
  assert.equal(parseDemoScenario('discord'), undefined);
  assert.equal(parseTaskId('task_ab'), undefined);
  assert.ok(parseTaskId('task_aabbccddeeff'));
  const bad = parseControlPatch({ maxAutonomy: 9 });
  assert.equal(bad.ok, false);
  const ok = parseControlPatch({ simulationMode: true, currentAutonomy: 1 });
  assert.equal(ok.ok, true);
  const control = new OwnerControl();
  if (ok.ok) {
    const next = applyOwnerControl(control, ok.patch);
    assert.equal(next.simulationMode, true);
    assert.equal(next.currentAutonomy, 1);
  }
  assert.deepEqual(sourceGraphLayout(['a.com', 'b.com']).map(item => item.domain), ['a.com', 'b.com']);
  assert.equal(systemNodeState({ attached: true, healthy: true }), 'AVAILABLE');
  assert.equal(systemNodeState({ blocked: true }), 'BLOCKED');
  const steps = liveOpsSteps({
    id: 'task_aabbccddeeff',
    objective: 'demo',
    createdAt: 't',
    updatedAt: 't',
    status: 'WAITING_PERMISSION',
    plan: [{
      id: 'understand_aa',
      title: 'Understand',
      kind: 'understand',
      dependencies: [],
      status: 'done',
      riskLevel: 'LOW',
      verificationMethod: 'simulation',
      retryPolicy: { maxAttempts: 1, attempted: 1 },
    }, {
      id: 'permission_aa',
      title: 'Ask owner',
      kind: 'permission',
      dependencies: ['understand_aa'],
      status: 'waiting_permission',
      riskLevel: 'LOW',
      verificationMethod: 'simulation',
      retryPolicy: { maxAttempts: 1, attempted: 1 },
    }],
    evidence: [],
    toolResults: [],
    permissionRequirements: [],
    retryBudget: 1,
    retriesUsed: 0,
    errors: [],
  });
  assert.equal(steps[0]?.state, 'done');
  assert.equal(steps[1]?.state, 'waiting');
});

function source(sourceId: string, title: string): SourceRecord {
  return {
    sourceId,
    url: `https://example.com/${sourceId}`,
    canonicalUrl: `https://example.com/${sourceId}`,
    domain: 'example.com',
    title,
    publishedAt: null,
    updatedAt: null,
    fetchedAt: null,
    contentType: 'text/html',
    provider: 'test',
    sourceClass: 'REFERENCE',
    trustSignals: { officialDomain: false, hasPublishedAt: false, https: true },
    status: 'fetched',
    cached: false,
  };
}

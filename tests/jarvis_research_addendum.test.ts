import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ANALYZER_INSUFFICIENT,
  ArtifactWorkflow,
  CapabilityCertificationBank,
  CommandCenterRuntime,
  MONEY_PRINTER_TURBO,
  ModelProfileRegistry,
  RuntimeSpecOptimizer,
  RuntimeSpecRegistry,
  SimulatedMediaProvider,
  THAI_COMBINING_FIXTURE,
  TraceAnalyzer,
  TraceStore,
  auditSchedulers,
  authorizeAtExecution,
  catalogModelProfiles,
  createJarvisRequest,
  efficiencyFromTraces,
  fuseMemoryRetrieval,
  mediaStageList,
  modelMayNotAuthorize,
  neverAutoPublish,
  parseObjective,
  presentCommandCenter,
  realModelCertificationBlocked,
  requestPublish,
  routeModelProfile,
  scheduledJobIsNotPermission,
} from '../src/jarvis';
import { OpsPersistence } from '../src/jarvis/ops/opsPersistence';
import { FORBIDDEN_TRACE_KEYS } from '../src/jarvis/ops/traceTypes';
import { SqliteJarvisMemoryStore, canonicalMemoryId, defaultRetention } from '../src/bot/memory/jarvis';
import type { RetrievedMemory } from '../src/jarvis/memory';

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('trace store persists facts only and strips chain-of-thought', () => {
  const root = tempRoot('jarvis-ops-');
  const ops = new OpsPersistence(path.join(root, 'ops.db'));
  const traces = new TraceStore({ db: ops.db });
  traces.record({
    requestId: 'req-1',
    route: 'CONVERSATION',
    inputText: THAI_COMBINING_FIXTURE,
    success: true,
    thoughts: 'secret reasoning',
    chainOfThought: 'do not store',
  } as never);
  const listed = traces.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.inputText, THAI_COMBINING_FIXTURE);
  for (const key of FORBIDDEN_TRACE_KEYS) {
    assert.equal((listed[0] as Record<string, unknown>)[key], undefined);
  }
  const dbPath = path.join(root, 'ops.db');
  ops.close();
  const reopenedOps = new OpsPersistence(dbPath);
  const reopened = new TraceStore({ db: reopenedOps.db });
  assert.equal(reopened.list()[0]?.inputText, THAI_COMBINING_FIXTURE);
  reopenedOps.close();
});

test('trace analyzer returns INSUFFICIENT_DATA instead of inventing metrics', () => {
  const analyzer = new TraceAnalyzer();
  const empty = analyzer.summarize([], 'route');
  assert.equal(empty.status, ANALYZER_INSUFFICIENT);
  const few = analyzer.summarize([
    { id: 'a', at: 't', route: 'WORK', success: true, totalLatencyMs: 10 },
    { id: 'b', at: 't', route: 'WORK', success: true, totalLatencyMs: 20 },
  ], 'route');
  assert.equal(few.status, ANALYZER_INSUFFICIENT);
  assert.equal(few.buckets[0]?.latencyP50Ms, undefined);
  const enough: Array<{ id: string; at: string; route: string; success: boolean; totalLatencyMs: number }> = [];
  for (let i = 0; i < 5; i += 1) {
    enough.push({ id: `t${i}`, at: 't', route: 'WORK', success: i > 0, totalLatencyMs: 10 * (i + 1) });
  }
  const ok = analyzer.summarize(enough, 'route');
  assert.equal(ok.status, 'ok');
  assert.ok(ok.buckets[0]?.successRate !== undefined);
  assert.ok(ok.buckets[0]?.latencyP50Ms !== undefined);
});

test('efficiency omits unmeasured cloud hardware', () => {
  const snapshot = efficiencyFromTraces([
    { id: 'a', at: 't', success: true, totalLatencyMs: 12, tokens: 8 },
    { id: 'b', at: 't', success: true, totalLatencyMs: 20, tokens: 9 },
    { id: 'c', at: 't', success: false, totalLatencyMs: 40, tokens: 2 },
  ]);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.ramBytes, undefined);
  assert.equal(snapshot.vramBytes, undefined);
  assert.equal(snapshot.energyJ, undefined);
  assert.equal(snapshot.cost, undefined);
  const none = efficiencyFromTraces([]);
  assert.equal(none.status, ANALYZER_INSUFFICIENT);
});

test('runtime spec is versioned and frozen security fields are not optimization variables', () => {
  const registry = new RuntimeSpecRegistry();
  const baseline = registry.current();
  assert.equal(baseline.version, 1);
  assert.equal(baseline.frozen.security, true);
  assert.equal(baseline.layers.learning.autoPromote, false);
  assert.equal(baseline.layers.toolsMemory.canonicalStore, 'sqlite');
  const optimizer = new RuntimeSpecOptimizer(registry);
  assert.throws(() => optimizer.hypothesize({
    hypothesis: 'weaken security',
    patch: { 'frozen.security': false } as never,
  }));
  assert.throws(() => optimizer.hypothesize({
    hypothesis: 'raise permissions',
    patch: { 'layers.permissions.maxAutonomy': 5 },
  }));
  const candidate = optimizer.hypothesize({
    hypothesis: 'raise retrieval topK within bounds',
    patch: { 'layers.intelligence.retrievalTopK': 12 },
    simulated: true,
  });
  assert.equal(candidate.status, 'HYPOTHESIS');
  assert.equal(candidate.spec.layers.intelligence.retrievalTopK, 12);
  assert.equal(candidate.spec.frozen.promotionRules, true);
  optimizer.isolateBenchmark(candidate.id, { before: 0.4, after: 0.7 });
  const reviewed = optimizer.regressionCheck(candidate.id, true);
  assert.equal(reviewed.status, 'PROMOTION_CANDIDATE');
  assert.equal(optimizer.autoPromote(), false);
  assert.equal(optimizer.productionPromotionAllowed(), false);
  assert.equal(registry.current().layers.intelligence.retrievalTopK, 8);
});

test('model profiles keep RESTRICTED specialists off the permission system', () => {
  const profiles = new ModelProfileRegistry();
  const uncensored = profiles.get('qwen38-27b-uncensored');
  assert.equal(uncensored?.trustTier, 'RESTRICTED');
  assert.equal(uncensored?.securityAuthority, false);
  assert.equal(modelMayNotAuthorize(uncensored!), true);
  const casual = routeModelProfile({ intent: 'casual_chat', profiles });
  assert.equal(casual.restrictedSelected, false);
  assert.equal(casual.usedSpeculativeScore, false);
  const nightBusy = routeModelProfile({ intent: 'night_background', profiles, hardware: { idle: false } });
  assert.equal(nightBusy.modelProfileId, 'local-env-llm');
  const nightIdle = routeModelProfile({ intent: 'night_background', profiles, hardware: { idle: true } });
  assert.equal(nightIdle.modelProfileId, 'qwen38-27b-aligned');
  assert.equal(nightIdle.restrictedSelected, false);
  assert.ok(catalogModelProfiles().every(item => item.securityAuthority === false));
});

test('capability certification uses fixtures and blocks live Ollama in cloud', () => {
  const bank = new CapabilityCertificationBank();
  const run = bank.runFixtures('cloud-fixture-chat');
  assert.equal(run.liveOllama, false);
  assert.equal(run.status, 'FIXTURE_ONLY');
  assert.equal(run.results.length, 10);
  assert.ok(run.results.every(item => item.simulated && item.passed));
  assert.equal(realModelCertificationBlocked(), 'BLOCKED_LOCAL_ACCEPTANCE');
});

test('artifact workflow and simulated media never auto-publish', () => {
  const workflow = new ArtifactWorkflow();
  const task = workflow.create({
    artifactClass: 'video',
    stages: mediaStageList(),
    provider: 'simulated-media',
    simulated: true,
  });
  const finished = workflow.run(task.taskId, new SimulatedMediaProvider());
  assert.equal(finished.status, 'ready');
  assert.equal(finished.validation.passed, true);
  assert.equal(finished.simulated, true);
  assert.equal(finished.publish, 'blocked_until_owner');
  assert.equal(neverAutoPublish(), false);
  assert.equal(MONEY_PRINTER_TURBO.installed, false);
  const publish = requestPublish({ artifactReady: true, ownerApproved: true, actionGateGranted: true });
  assert.equal(publish.allowed, false);
  assert.equal(publish.gate, 'PUBLISH');
});

test('memory fusion keeps SQLite canonical and drops index-only orphans', () => {
  const lexical: RetrievedMemory[] = [
    { canonicalId: 'fact:thai', kind: 'fact', status: 'active', text: THAI_COMBINING_FIXTURE, evidenceIds: [], confidence: 0.9 },
    { canonicalId: 'fact:other', kind: 'fact', status: 'active', text: 'other', evidenceIds: [], confidence: 0.4 },
  ];
  const fused = fuseMemoryRetrieval({
    lexical,
    semantic: [
      { canonicalId: 'fact:thai', score: 0.99, text: 'index snippet must not win' },
      { canonicalId: 'fact:ghost', score: 1, text: 'no sqlite record' },
    ],
    topK: 4,
  });
  assert.equal(fused.canonicalStore, 'sqlite');
  assert.equal(fused.qdrantRole, 'derived_index');
  assert.equal(fused.mode, 'fused');
  assert.equal(fused.items[0]?.canonicalId, 'fact:thai');
  assert.equal(fused.items[0]?.text, THAI_COMBINING_FIXTURE);
  assert.equal(fused.items.some(item => item.canonicalId === 'fact:ghost'), false);
  const lexicalOnly = fuseMemoryRetrieval({ lexical, semantic: [] });
  assert.equal(lexicalOnly.mode, 'lexical_only');
});

test('scheduler audit does not add a competing scheduler and jobs are not permissions', () => {
  const audit = auditSchedulers();
  assert.equal(audit.competingSchedulerAdded, false);
  assert.equal(audit.jobIsPermanentPermission, false);
  assert.equal(scheduledJobIsNotPermission(), false);
  assert.equal(audit.schedulers.length, 3);
  const denied = authorizeAtExecution({ capabilityId: 'desktop.openApplication', grantPresent: false, leaseValid: false });
  assert.equal(denied.allowed, false);
});

test('Thai Unicode round-trips HTTP, request, task, memory, trace, JSON, and Command Center', async () => {
  assert.equal(parseObjective(THAI_COMBINING_FIXTURE), THAI_COMBINING_FIXTURE);
  const request = createJarvisRequest({ text: `  ${THAI_COMBINING_FIXTURE}  `, sessionId: 'thai-lab' });
  assert.equal(request.input.text, THAI_COMBINING_FIXTURE);
  assert.equal(JSON.parse(JSON.stringify(request)).input.text, THAI_COMBINING_FIXTURE);

  const root = tempRoot('jarvis-thai-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const now = 2_000;
  store.putFact({
    id: canonicalMemoryId('fact', 'thai'),
    kind: 'fact',
    predicate: 'says',
    objectValue: THAI_COMBINING_FIXTURE,
    factKey: 'thai.fixture',
    polarity: 'statement',
    status: 'active',
    privacyClass: 'private',
    confidence: 0.9,
    importance: 0.5,
    provenance: {
      sourceSystem: 'test',
      sourceRecordId: 'thai',
      evidenceIds: [],
      firstSeen: now,
      lastConfirmed: now,
      confirmations: 1,
    },
    retention: defaultRetention('long_lived', now),
  });
  const loaded = store.listFacts({ factKey: 'thai.fixture' })[0];
  assert.equal(loaded?.objectValue, THAI_COMBINING_FIXTURE);
  store.close();

  const center = new CommandCenterRuntime({
    persistRoot: path.join(root, 'runtime'),
    simulated: true,
  });
  const task = await center.runObjective(THAI_COMBINING_FIXTURE, { simulated: true, sessionId: 'thai-lab' });
  assert.equal(task.objective, THAI_COMBINING_FIXTURE);
  const presented = presentCommandCenter(center.snapshot());
  assert.equal(presented.intelligence.traces.lastInput, THAI_COMBINING_FIXTURE);
  assert.equal(presented.intelligence.analyzer.status, ANALYZER_INSUFFICIENT);
  assert.equal(presented.intelligence.productionPromotionAllowed, false);
  assert.equal(presented.intelligence.scheduler.competingSchedulerAdded, false);
});

test('command center intelligence stays honest and night cycle never auto-promotes specs', () => {
  const center = new CommandCenterRuntime({ simulated: true });
  const cert = center.certifications.runFixtures('cloud-fixture-chat');
  assert.equal(cert.status, 'FIXTURE_ONLY');
  for (let i = 0; i < 3; i += 1) {
    center.recordTurnTrace({
      route: 'WORK',
      retryCount: 3,
      success: false,
      simulated: true,
    });
  }
  const night = center.runNight();
  assert.equal(night.autoPromoted, false);
  assert.ok(night.specCandidatesReviewed >= 1);
  const snapshot = presentCommandCenter(center.snapshot());
  assert.ok(snapshot.intelligence.models.some(item => item.trustTier === 'RESTRICTED'));
  assert.equal(snapshot.intelligence.specCandidates.some(item => item.status === 'HYPOTHESIS' || item.status === 'PROMOTION_CANDIDATE'), true);
  assert.doesNotMatch(JSON.stringify(snapshot), /chainOfThought|hiddenReasoning/);
});

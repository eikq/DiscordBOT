import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CERT_CATEGORIES,
  CapabilityCertificationBank,
  CommandCenterRuntime,
  MODEL_WORKLOADS,
  ModelProfileRegistry,
  catalogModelProfiles,
  certificationIsLiveVerified,
  cloudCertificationLabel,
  efficiencyForModel,
  efficiencyFromTraces,
  modelMayNotAuthorize,
  neverAutoSelectRestricted,
  normalizeWorkload,
  realModelCertificationBlocked,
  routeModelProfile,
  workloadFromRoute,
} from '../src/jarvis';
import { OpsPersistence } from '../src/jarvis/ops/opsPersistence';
import { FORBIDDEN_TRACE_KEYS } from '../src/jarvis/ops/traceTypes';
import { TraceStore } from '../src/jarvis/ops/traceStore';
import { normalizeCertificationRun } from '../src/jarvis/models/capabilityCertification';
import { isKnownAbility, normalizeProfile } from '../src/jarvis/models/profileNormalize';
import type { ModelWorkload } from '../src/jarvis/models/types';

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('model profiles keep unknown abilities unverified and never invent hardware', () => {
  const incomplete = normalizeProfile({ id: 'legacy-seed' });
  assert.equal(incomplete.trustTier, 'STANDARD');
  assert.equal(incomplete.coding, 'unverified');
  assert.equal(incomplete.research, 'unverified');
  assert.equal(incomplete.vision, 'unverified');
  assert.equal(incomplete.recovery, 'unverified');
  assert.equal(incomplete.latencyEvidence.source, 'unverified');
  assert.equal(incomplete.throughputEvidence.source, 'unverified');
  assert.equal(incomplete.hardwareRequirements.measured, false);
  assert.equal(incomplete.hardwareRequirements.ramBytes, undefined);
  assert.equal(incomplete.hardwareRequirements.vramBytes, undefined);
  assert.equal(incomplete.securityAuthority, false);
  assert.equal(isKnownAbility('unverified'), false);
  assert.equal(isKnownAbility('unknown'), false);
  assert.equal(isKnownAbility('fixture_only'), true);

  const persist = {
    load: () => [{ id: 'legacy-only', family: 'unknown', trustTier: 'STANDARD' as const }],
    replace() {},
  };
  const registry = new ModelProfileRegistry(persist as never);
  const loaded = registry.get('legacy-only');
  assert.equal(loaded?.modelId, 'legacy-only');
  assert.equal(loaded?.thai, 'unverified');
  assert.equal(loaded?.certificationState, 'UNVERIFIED');
  assert.equal(loaded?.available, true);
});

test('RESTRICTED models are never auto-selected and are never security authorities', () => {
  const profiles = new ModelProfileRegistry();
  const uncensored = profiles.get('qwen38-27b-uncensored');
  assert.equal(uncensored?.trustTier, 'RESTRICTED');
  assert.equal(uncensored?.securityAuthority, false);
  assert.equal(modelMayNotAuthorize(uncensored!), true);
  assert.equal(neverAutoSelectRestricted(uncensored!), true);
  assert.ok(catalogModelProfiles().every(item => item.securityAuthority === false));

  for (const workload of MODEL_WORKLOADS) {
    const decision = routeModelProfile({
      intent: workload,
      profiles,
      hardware: { preferredModelId: 'qwen38-27b-uncensored', idle: true },
    });
    assert.equal(decision.restrictedSelected, false);
    assert.notEqual(decision.modelProfileId, 'qwen38-27b-uncensored');
    assert.notEqual(decision.trustTier, 'RESTRICTED');
    assert.equal(decision.usedSpeculativeScore, false);
    assert.equal(decision.idleAssumed, false);
  }
});

test('fallback uses a compatible trusted model and exposes the reason', () => {
  const profiles = new ModelProfileRegistry();
  profiles.setAvailable('qwen38-27b-aligned', false);
  const night = routeModelProfile({
    intent: 'night_background',
    profiles,
    hardware: { idle: true },
  });
  assert.equal(night.modelProfileId, 'local-env-llm');
  assert.equal(night.fallbackFrom, 'qwen38-27b-aligned');
  assert.equal(night.fallbackReason, 'unavailable');
  assert.equal(night.restrictedSelected, false);

  profiles.setAvailable('local-env-llm', false);
  const stillTrusted = routeModelProfile({
    intent: 'casual',
    profiles,
  });
  assert.equal(stillTrusted.modelProfileId, 'cloud-fixture-chat');
  assert.notEqual(stillTrusted.modelProfileId, 'qwen38-27b-uncensored');
});

test('unverified abilities are not treated as certified evidence', () => {
  const profiles = new ModelProfileRegistry();
  const qwen = profiles.get('qwen38-27b-aligned');
  assert.equal(qwen?.coding, 'unverified');
  assert.equal(qwen?.reasoning, 'unverified');
  assert.equal(qwen?.research, 'unverified');
  const coding = routeModelProfile({ intent: 'coding', profiles });
  assert.equal(coding.modelProfileId, 'cloud-fixture-chat');
  assert.equal(coding.fallbackFrom, 'qwen38-27b-aligned');
  assert.equal(coding.fallbackReason, 'incompatible_or_unverified');
  const deep = routeModelProfile({ intent: 'deep_reasoning', profiles });
  assert.equal(deep.modelProfileId, 'cloud-fixture-chat');
  const research = routeModelProfile({ intent: 'research', profiles });
  assert.equal(research.modelProfileId, 'cloud-fixture-chat');
});

test('cloud certification is fixture-only and never LIVE_VERIFIED', () => {
  const bank = new CapabilityCertificationBank();
  const run = bank.runFixtures('cloud-fixture-chat');
  assert.equal(run.status, 'FIXTURE_ONLY');
  assert.equal(run.liveOllama, false);
  assert.equal(run.liveVerified, false);
  assert.equal(certificationIsLiveVerified(run), false);
  assert.equal(cloudCertificationLabel(run), 'FIXTURE_ONLY');
  assert.equal(realModelCertificationBlocked(), 'BLOCKED_LOCAL_ACCEPTANCE');
  assert.equal(run.results.length, CERT_CATEGORIES.length);
  assert.deepEqual(run.results.map(item => item.category), [...CERT_CATEGORIES]);
  assert.ok(run.results.every(item => item.simulated && item.passed));
  assert.equal(JSON.stringify(run).includes('LIVE_VERIFIED'), false);

  const restored = normalizeCertificationRun({
    id: 'old',
    modelProfileId: 'cloud-fixture-chat',
    status: 'LIVE_VERIFIED' as never,
    liveOllama: true as never,
    liveVerified: true as never,
    results: [],
  });
  assert.equal(restored.status, 'FIXTURE_ONLY');
  assert.equal(restored.liveOllama, false);
  assert.equal(restored.liveVerified, false);

  const persisted = new CapabilityCertificationBank(() => 1, {
    load: () => [{
      id: 'c1',
      at: 't',
      modelProfileId: 'cloud-fixture-chat',
      status: 'FIXTURE_ONLY',
      liveOllama: false,
      results: [],
    }] as never,
    replace() {},
  });
  assert.equal(persisted.latest()?.liveVerified, false);
});

test('routing follows workload class, policy, and latency preference', () => {
  const profiles = new ModelProfileRegistry();
  const expected: Record<ModelWorkload, string> = {
    casual: 'cloud-fixture-chat',
    information: 'cloud-fixture-chat',
    deep_reasoning: 'cloud-fixture-chat',
    research: 'cloud-fixture-chat',
    coding: 'cloud-fixture-chat',
    voice_realtime: 'local-env-llm',
    night_background: 'local-env-llm',
    vision: 'cloud-fixture-chat',
  };
  for (const workload of MODEL_WORKLOADS) {
    const decision = routeModelProfile({ intent: workload, profiles });
    assert.equal(decision.workload, workload);
    assert.equal(decision.modelProfileId, expected[workload], workload);
    assert.equal(decision.restrictedSelected, false);
  }
  assert.equal(normalizeWorkload('casual_chat'), 'casual');
  assert.equal(normalizeWorkload('voice'), 'voice_realtime');
  assert.equal(workloadFromRoute('RESEARCH', 'ค้นคว้า'), 'research');
  assert.equal(workloadFromRoute('WORK', 'implement the patch'), 'coding');

  const realtime = routeModelProfile({
    intent: 'voice_realtime',
    profiles,
    hardware: { latencyBudgetMs: 250 },
  });
  assert.equal(realtime.modelProfileId, 'local-env-llm');
  assert.notEqual(realtime.modelProfileId, 'qwen38-27b-aligned');

  profiles.setAvailable('local-env-llm', false);
  const realtimeFallback = routeModelProfile({ intent: 'voice', profiles });
  assert.equal(realtimeFallback.modelProfileId, 'cloud-fixture-chat');
  assert.notEqual(realtimeFallback.modelProfileId, 'qwen38-27b-aligned');
});

test('night stronger model requires measured idle, never assumed idle', () => {
  const profiles = new ModelProfileRegistry();
  const busy = routeModelProfile({ intent: 'night_background', profiles, hardware: { idle: false } });
  assert.equal(busy.modelProfileId, 'local-env-llm');
  assert.equal(busy.fallbackReason, 'not_idle');
  assert.equal(busy.hardwareUsed, false);

  const omitted = routeModelProfile({ intent: 'night_background', profiles });
  assert.equal(omitted.modelProfileId, 'local-env-llm');

  const assumed = routeModelProfile({
    intent: 'night_background',
    profiles,
    hardware: { idle: true, idleSource: 'assumed' },
  });
  assert.equal(assumed.modelProfileId, 'local-env-llm');
  assert.equal(assumed.idleAssumed, false);

  const idle = routeModelProfile({
    intent: 'night_background',
    profiles,
    hardware: { idle: true },
  });
  assert.equal(idle.modelProfileId, 'qwen38-27b-aligned');
  assert.equal(idle.hardwareUsed, true);
  assert.equal(idle.restrictedSelected, false);
});

test('owner preference cannot select RESTRICTED and traces keep fallback facts', async () => {
  const profiles = new ModelProfileRegistry();
  const ignored = routeModelProfile({
    intent: 'casual',
    profiles,
    hardware: { preferredModelId: 'qwen38-27b-uncensored' },
  });
  assert.notEqual(ignored.modelProfileId, 'qwen38-27b-uncensored');
  assert.equal(ignored.restrictedSelected, false);

  const owner = routeModelProfile({
    intent: 'casual',
    profiles,
    hardware: { preferredModelId: 'local-env-llm' },
  });
  assert.equal(owner.modelProfileId, 'local-env-llm');

  const root = tempRoot('jarvis-models-v2-');
  const ops = new OpsPersistence(path.join(root, 'ops.db'));
  const traces = new TraceStore({ db: ops.db });
  traces.record({
    route: 'WORK',
    workload: 'coding',
    modelProfileId: 'cloud-fixture-chat',
    fallbackFrom: 'qwen38-27b-aligned',
    fallbackReason: 'incompatible_or_unverified',
    success: true,
    thoughts: 'secret reasoning',
    chainOfThought: 'do not store',
  } as never);
  const listed = traces.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.modelProfileId, 'cloud-fixture-chat');
  assert.equal(listed[0]?.workload, 'coding');
  assert.equal(listed[0]?.fallbackFrom, 'qwen38-27b-aligned');
  assert.equal(listed[0]?.fallbackReason, 'incompatible_or_unverified');
  for (const key of FORBIDDEN_TRACE_KEYS) {
    assert.equal((listed[0] as Record<string, unknown>)[key], undefined);
  }
  ops.close();

  const center = new CommandCenterRuntime({ simulated: true });
  await center.runObjective('hello', { simulated: true, sessionId: 'models-v2' });
  const casualTrace = center.traces.list().at(-1);
  assert.equal(casualTrace?.workload, 'casual');
  assert.equal(casualTrace?.modelProfileId, 'local-env-llm');
  assert.notEqual(casualTrace?.modelProfileId, 'qwen38-27b-uncensored');

  await center.runObjective('research the latest Qwen documentation', { simulated: true, sessionId: 'models-v2' });
  const researchTrace = center.traces.list().at(-1);
  assert.equal(researchTrace?.workload, 'research');
  assert.equal(researchTrace?.modelProfileId, 'cloud-fixture-chat');
  assert.equal(researchTrace?.fallbackFrom, 'local-env-llm');
  const presented = center.present();
  assert.equal(presented.intelligence.traces.lastModelProfileId, 'cloud-fixture-chat');
  assert.equal(presented.intelligence.traces.lastWorkload, 'research');
  assert.doesNotMatch(JSON.stringify(presented), /LIVE_VERIFIED|chainOfThought|hiddenReasoning/);
});

test('efficiency records success, latency, tokens, and omits unprobed hardware', () => {
  const traces = [
    { id: 'a', at: 't', modelProfileId: 'local-env-llm', success: true, totalLatencyMs: 12, tokens: 8, tokensPerSec: 4, retryCount: 0, toolResults: [{ toolName: 'lab.ping', status: 'ok' }] },
    { id: 'b', at: 't', modelProfileId: 'local-env-llm', success: true, totalLatencyMs: 20, tokens: 9, tokensPerSec: 5, retryCount: 1 },
    { id: 'c', at: 't', modelProfileId: 'cloud-fixture-chat', success: false, totalLatencyMs: 40, tokens: 2, tokensPerSec: 1, retryCount: 2 },
    { id: 'd', at: 't', modelProfileId: 'local-env-llm', success: true, totalLatencyMs: 18, tokens: 7, tokensPerSec: 3, retryCount: 0 },
    { id: 'e', at: 't', modelProfileId: 'local-env-llm', success: true, totalLatencyMs: 16, tokens: 6, tokensPerSec: 3, retryCount: 0 },
  ];
  const snapshot = efficiencyFromTraces(traces);
  assert.equal(snapshot.status, 'ok');
  assert.equal(snapshot.successRate, snapshot.success);
  assert.ok(typeof snapshot.latencyMs === 'number');
  assert.ok(typeof snapshot.p50Ms === 'number');
  assert.ok(typeof snapshot.p95Ms === 'number');
  assert.ok(typeof snapshot.tokens === 'number');
  assert.ok(typeof snapshot.tokensPerSec === 'number');
  assert.equal(snapshot.toolCalls, 1);
  assert.equal(snapshot.retries, 3);
  assert.equal(snapshot.ramBytes, undefined);
  assert.equal(snapshot.vramBytes, undefined);
  assert.equal(snapshot.energyJ, undefined);

  const probed = efficiencyFromTraces(traces, { ramBytes: 2048 });
  assert.equal(probed.ramBytes, 2048);
  assert.equal(probed.vramBytes, undefined);

  const perModel = efficiencyForModel(traces, 'cloud-fixture-chat');
  assert.equal(perModel.sampleCount, 1);
  assert.equal(perModel.ramBytes, undefined);
});

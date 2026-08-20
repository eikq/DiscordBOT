import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BenchmarkBank,
  CommandCenterRuntime,
  DISTINCT_FAILURE_CODES,
  ExperienceStore,
  FakeNativeJarvisHelper,
  ModelProfileRegistry,
  MockTtsPort,
  NATIVE_HELPER_PROTOCOL_VERSION,
  NightCycle,
  PerceptionRuntime,
  SkillVersionRegistry,
  TraceAnalyzer,
  TraceStore,
  VoiceInteractionRuntime,
  WorkAgent,
  catalogModelProfiles,
  classifyFailure,
  classifyFailureKnowledge,
  correlationIsCoherent,
  createCapabilityWorkInvoker,
  createCorrelationIds,
  createJarvisRequest,
  neverAutoSelectRestricted,
  planForObjective,
  routeJarvisRequest,
  routeModelProfile,
  runPresentationPipeline,
  shouldUseWorkAgent,
  toTraceCorrelation,
} from '../src/jarvis';
import { newStepId } from '../src/jarvis/agent/store';
import type { PlanStep } from '../src/jarvis/agent/types';
import { CapabilityRegistry } from '../src/jarvis/capabilities/CapabilityRegistry';
import type { CapabilityHost, CapabilityResult } from '../src/jarvis/capabilities/types';
import { displayForWindow } from '../src/jarvis/desktop';
import { runCloudBenchmarkBank } from '../src/jarvis/evolution/benchmarkFixtures';
import { JarvisMemoryRetrieval } from '../src/jarvis/memory';
import { createPlayback } from '../src/jarvis/presentation/briefing/playback';
import { ResearchRuntime } from '../src/jarvis/research/researchRuntime';
import { DEPTH_BUDGETS, planStructuredResearch } from '../src/jarvis/research/queryPlan';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';
import { deriveGlobalPresence, presentIntelligence } from '../src/jarvis/ui/commandCenterV2';
import { SqliteJarvisMemoryStore, canonicalMemoryId, defaultRetention } from '../src/bot/memory/jarvis';
import type { SemanticFactRecord } from '../src/bot/memory/jarvis/types';

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

function step(kind: PlanStep['kind'], deps: string[] = [], extra: Partial<PlanStep> = {}): PlanStep {
  return {
    id: newStepId(kind),
    title: kind,
    kind,
    dependencies: deps,
    status: 'pending',
    riskLevel: extra.riskLevel ?? 'LOW',
    verificationMethod: 'unit',
    retryPolicy: { maxAttempts: 1, attempted: 0 },
    ...extra,
  };
}

async function waitFor(predicate: () => boolean, label: string, timeoutMs = 1_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('distinct failure codes stay distinct and are not collapsed', () => {
  assert.deepEqual([...DISTINCT_FAILURE_CODES], [
    'UNSUPPORTED_HOST',
    'PERMISSION_REQUIRED',
    'DENIED',
    'TIMEOUT',
    'PROVIDER_UNAVAILABLE',
    'INSUFFICIENT_DATA',
    'UNKNOWN_DISPLAY',
    'VERIFICATION_FAILED',
  ]);
  assert.equal(classifyFailure({ reasonCode: 'UNSUPPORTED_HOST' }), 'UNSUPPORTED_HOST');
  assert.equal(classifyFailure({ reasonCode: 'PERMISSION_REQUIRED' }), 'PERMISSION_REQUIRED');
  assert.equal(classifyFailure({ reasonCode: 'DENIED' }), 'DENIED');
  assert.equal(classifyFailure({ reasonCode: 'TIMEOUT' }), 'TIMEOUT');
  assert.equal(classifyFailure({ reasonCode: 'timeout' }), 'TIMEOUT');
  assert.equal(classifyFailure({ reasonCode: 'PROVIDER_UNAVAILABLE' }), 'PROVIDER_UNAVAILABLE');
  assert.equal(classifyFailure({ reasonCode: 'INSUFFICIENT_DATA' }), 'INSUFFICIENT_DATA');
  assert.equal(classifyFailure({ reasonCode: 'UNKNOWN_DISPLAY' }), 'UNKNOWN_DISPLAY');
  assert.equal(classifyFailure({ reasonCode: 'VERIFICATION_FAILED' }), 'VERIFICATION_FAILED');
  assert.equal(classifyFailure({ reasonCode: 'RESEARCH_TIMEOUT' }), 'RESEARCH_TIMEOUT');
  assert.equal(classifyFailure({ reasonCode: 'CAPABILITY_DENIED' }), 'CAPABILITY_DENIED');
  assert.equal(classifyFailure({ message: 'Native helper is not installed' }), 'UNSUPPORTED_HOST');
  assert.equal(classifyFailure({ message: 'unknown display: Jarvis window is not intersecting a known monitor' }), 'UNKNOWN_DISPLAY');
  assert.equal(classifyFailure({ message: 'INSUFFICIENT_DATA until more traces exist' }), 'INSUFFICIENT_DATA');
  assert.equal(classifyFailure({ message: 'owner denied' }), 'CAPABILITY_DENIED');
  assert.equal(classifyFailure({ reasonCode: 'SELF_APPROVAL_DENIED' }), 'DENIED');
  assert.equal(classifyFailure({ stage: 'research', message: 'timed out' }), 'RESEARCH_TIMEOUT');
  assert.equal(classifyFailure({ message: 'step timed out' }), 'TIMEOUT');
  assert.equal(classifyFailureKnowledge('DENIED'), 'owner_denied');
  assert.equal(classifyFailureKnowledge('TIMEOUT'), 'provider_timeout');
  assert.equal(classifyFailureKnowledge('UNSUPPORTED_HOST'), 'unsupported_host');
  assert.equal(classifyFailureKnowledge('UNKNOWN_DISPLAY'), 'unsupported_host');
  assert.notEqual(classifyFailure({ reasonCode: 'TIMEOUT' }), 'STEP_FAILED');
  assert.notEqual(classifyFailure({ reasonCode: 'DENIED' }), 'PERMISSION_REQUIRED');
  assert.notEqual(classifyFailure({ reasonCode: 'UNSUPPORTED_HOST' }), 'PROVIDER_UNAVAILABLE');
});

test('capability timeouts keep research vs generic TIMEOUT apart', async () => {
  const host = testHost({
    'system.status': () => result('system.status', { status: 'timeout', error: 'status probe timed out', content: '' }),
    'research.search': () => result('research.search', { status: 'timeout', error: 'search timed out', content: '' }),
  });
  const invoke = createCapabilityWorkInvoker({ host });
  const statusTask = new WorkAgent({ invoke }).receive('Read system status', [
    step('understand'),
    step('apply', [], { capability: 'system.status' }),
  ]);
  const status = await invoke(statusTask, statusTask.plan[1]!, new AbortController().signal);
  assert.equal(status.errorCode, 'TIMEOUT');
  const researchTask = new WorkAgent({ invoke }).receive('research the latest Qwen documentation', [
    step('understand'),
    step('research', [], { capability: 'research.search' }),
  ]);
  const research = await invoke(researchTask, researchTask.plan[1]!, new AbortController().signal);
  assert.equal(research.errorCode, 'RESEARCH_TIMEOUT');
});

test('correlation ids stay coherent across request, work, trace, and presentation', () => {
  const ids = createCorrelationIds({
    sessionId: 'sess-cloud-11',
    requestId: 'req-cloud-11',
    turnId: 'turn-cloud-11',
    taskId: 'task-cloud-11',
    stepId: 'step-cloud-11',
    traceId: 'tr-cloud-11',
    presentationId: 'pres-cloud-11',
  });
  assert.equal(correlationIsCoherent(ids), true);
  assert.notEqual(ids.turnId, ids.requestId);
  const traces = new TraceStore();
  const recorded = traces.record({
    ...toTraceCorrelation(ids),
    route: 'WORK',
    simulated: true,
    success: true,
    inputText: 'inspect these files',
  });
  assert.equal(recorded.id, 'tr-cloud-11');
  assert.equal(recorded.sessionId, ids.sessionId);
  assert.equal(recorded.requestId, ids.requestId);
  assert.equal(recorded.turnId, ids.turnId);
  assert.equal(recorded.taskId, ids.taskId);
  assert.equal(recorded.stepId, ids.stepId);
  assert.equal(recorded.presentationId, ids.presentationId);
  const playback = createPlayback(ids.presentationId!, [
    {
      id: 'n1',
      order: 0,
      text: 'Summary',
      kind: 'summary',
      target: { type: 'section', id: 's1' },
      estimatedMs: 400,
    },
  ]);
  assert.equal(playback.presentationId, ids.presentationId);
  assert.equal(correlationIsCoherent(createCorrelationIds({ ...ids, stepId: 'orphan' , taskId: undefined })), false);
});

test('1 casual conversation stays off WorkAgent and keeps session/request/turn ids', async () => {
  const center = new CommandCenterRuntime({ persistRoot: tempRoot('jarvis-q11-casual-') });
  const lab = createJarvisLabRuntime({
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
  const routed = routeJarvisRequest({ text: 'hello' });
  assert.equal(routed.route, 'CONVERSATION');
  assert.equal(shouldUseWorkAgent(routed), false);
  const asked = await lab.ask({ text: 'hello', sessionId: 'q11-casual' });
  assert.equal(asked.route?.route, 'CONVERSATION');
  assert.equal(asked.taskId, undefined);
  const trace = center.traces.list(1)[0];
  assert.ok(trace);
  assert.equal(trace.sessionId, 'q11-casual');
  assert.equal(trace.requestId, asked.request.requestId);
  assert.ok(trace.turnId);
  assert.equal(correlationIsCoherent(createCorrelationIds({
    sessionId: trace.sessionId,
    requestId: trace.requestId,
    turnId: trace.turnId,
  })), true);
  center.agent.store.close();
  center.persistence?.close();
});

test('2 informational question stays informational and does not mint a work task', async () => {
  const center = new CommandCenterRuntime({ persistRoot: tempRoot('jarvis-q11-info-') });
  const lab = createJarvisLabRuntime({
    commandCenter: center,
    attachDefaultMemory: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
    workspace: false,
    llm: { generateText: async () => 'Recursion is a function calling itself.' },
  });
  const routed = routeJarvisRequest({ text: 'explain recursion' });
  assert.equal(routed.route, 'INFORMATION');
  assert.equal(shouldUseWorkAgent(routed), false);
  const asked = await lab.ask({ text: 'explain recursion', sessionId: 'q11-info' });
  assert.equal(asked.route?.route, 'INFORMATION');
  assert.equal(asked.taskId, undefined);
  assert.equal(center.agent.store.list().length, 0);
  center.agent.store.close();
  center.persistence?.close();
});

test('3 deep research uses the deep budget and keeps sources as untrusted data', async () => {
  const routed = routeJarvisRequest({ text: 'research the latest Qwen documentation' });
  assert.equal(routed.route, 'RESEARCH');
  assert.equal(shouldUseWorkAgent(routed), true);
  const deep = planStructuredResearch({ query: 'latest Qwen documentation', depth: 'deep' });
  const quick = planStructuredResearch({ query: 'latest Qwen documentation', depth: 'quick' });
  assert.ok(deep.queries.length > quick.queries.length);
  assert.equal(deep.budget.verification, true);
  assert.equal(DEPTH_BUDGETS.deep.contradictionAnalysis, true);
  const runtime = new ResearchRuntime({
    providers: [{
      id: 'fixture',
      async search() {
        return [{ url: 'https://example.com/qwen', title: 'Qwen docs', provider: 'fixture' }];
      },
    }],
    fetcher: {
      async fetchPublic(url: string) {
        return {
          url,
          finalUrl: url,
          contentType: 'text/html',
          bodyText: '<html><head><title>Qwen</title></head><body><p>Official Qwen documentation notes a 27B local model.</p></body></html>',
          status: 200,
        };
      },
    } as never,
  });
  const result = await runtime.current({ query: 'latest Qwen documentation', depth: 'deep' });
  assert.ok(result.sources.length >= 1);
  assert.equal(result.depth, 'deep');
  assert.doesNotMatch(JSON.stringify(result), /LIVE_VERIFIED/);
});

test('4 system diagnostic presents snapshot facts without claiming live hardware', () => {
  const planned = runPresentationPipeline({
    text: 'system status',
    capabilityId: 'system.status',
    replyText: 'CPU 12 percent, RAM 40 percent.',
    systemSnapshot: {
      summary: 'Host telemetry snapshot',
      cpu: { usagePct: 12, cores: 16 },
      ram: { usedPct: 40, totalMb: 64_000 },
    },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  assert.match(planned.summary, /12|CPU|status/i);
  assert.equal(planned.playback.presentationId.startsWith('pres_') || planned.id.startsWith('pres_'), true);
  const presence = deriveGlobalPresence({ simulationMode: true, perceptionSimulated: true });
  assert.equal(presence.presence, 'SIMULATION');
  assert.equal(presence.hardwareClaim, 'none');
});

test('5 safe read-only capability completes without a permission gate', async () => {
  const host = testHost({
    'system.status': () => result('system.status', { content: 'cpu 12 ram 40' }),
  });
  const ids = createCorrelationIds({ sessionId: 'q11-safe', requestId: 'req-safe', turnId: 'turn-safe' });
  const agent = new WorkAgent({
    invoke: createCapabilityWorkInvoker({ host, sessionId: ids.sessionId }),
    simulated: true,
  });
  const plan = planForObjective('Read system status', 'system.status');
  assert.ok(!plan.some(item => item.kind === 'permission'));
  const task = agent.receive('Read system status', plan, {
    sessionId: ids.sessionId,
    requestId: ids.requestId,
    turnId: ids.turnId,
  });
  const done = await agent.run(task.id);
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.sessionId, ids.sessionId);
  assert.equal(done.requestId, ids.requestId);
  assert.equal(done.turnId, ids.turnId);
  assert.ok(done.plan.some(item => item.kind !== 'permission' || item.status === 'done'));
});

test('6 permission-gated WorkAgent waits, rejects self-approval, and records DENIED', async () => {
  const host = testHost({
    'desktop.openSettings': () => result('desktop.openSettings', {
      status: 'confirmation_required',
      content: '',
      error: 'Allow once required',
      sideEffect: 'write',
      structured: { proposalId: 'ap-q11', confirmToken: 'tok-q11', risk: 'CONFIRM_REQUIRED' },
    }),
  });
  const ids = createCorrelationIds({ sessionId: 'q11-perm' });
  const agent = new WorkAgent({ invoke: createCapabilityWorkInvoker({ host }) });
  const understand = step('understand');
  const apply = step('apply', [understand.id], {
    capability: 'desktop.openSettings',
    riskLevel: 'MEDIUM',
  });
  const task = agent.receive('change this system setting', [understand, apply], {
    sessionId: ids.sessionId,
    requestId: ids.requestId,
    turnId: ids.turnId,
  });
  const paused = await agent.run(task.id);
  assert.equal(paused.status, 'WAITING_PERMISSION');
  assert.equal(paused.requestId, ids.requestId);
  assert.throws(() => agent.grantPermission(task.id, { actor: 'jarvis' }), /cannot approve/i);
  const denied = agent.denyPermission(task.id);
  assert.equal(denied.status, 'BLOCKED');
  assert.equal(denied.plan.find(item => item.id === apply.id)?.errorCode, 'DENIED');
  assert.ok(denied.errors.some(item => item.code === 'DENIED' && item.stepId === apply.id));
});

test('7 Presenter briefing keeps presentationId on the playback clock', () => {
  const planned = runPresentationPipeline({
    text: 'brief me on the comparison',
    replyText: 'Source A is newer than source B.',
    research: {
      query: 'compare those two sources',
      synthesis: 'Source A is newer than source B.',
      sources: [
        { sourceId: 'src_a', title: 'A', url: 'https://example.com/a', trustClass: 'news' },
        { sourceId: 'src_b', title: 'B', url: 'https://example.com/b', trustClass: 'news' },
      ],
      evidence: [{ evidenceId: 'evd_1', claim: 'A is newer', sourceId: 'src_a' }],
    },
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  assert.equal(planned.playback.presentationId, planned.id);
  const playback = createPlayback(planned.id, planned.narrationSegments);
  assert.equal(playback.presentationId, planned.id);
});

test('8 memory-assisted turn retrieves owner-trusted facts from SQLite', () => {
  const root = tempRoot('jarvis-q11-mem-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  try {
    const now = 3_000;
    const fact: SemanticFactRecord = {
      id: canonicalMemoryId('fact', 'favorite.drink'),
      kind: 'fact',
      predicate: 'favorite.drink',
      objectValue: 'black coffee',
      factKey: 'favorite.drink',
      polarity: 'statement',
      status: 'active',
      privacyClass: 'private',
      confidence: 0.95,
      importance: 0.8,
      provenance: {
        sourceSystem: 'owner_correction',
        evidenceIds: ['owner:owner'],
        firstSeen: now,
        lastConfirmed: now,
        confirmations: 1,
      },
      retention: defaultRetention('long_lived', now),
      memoryClass: 'identity',
      ownerTrusted: true,
    };
    store.putFact(fact);
    const retrieval = new JarvisMemoryRetrieval(store);
    const turn = retrieval.retrieveForTurn({ text: 'favorite.drink', now });
    assert.equal(turn.degraded, false);
    assert.ok(turn.items.some(item => item.text.includes('black coffee') && item.ownerTrusted === true));
  } finally {
    store.close();
  }
});

test('9 skill-assisted task retrieves only owner-trusted skills', () => {
  const skills = new SkillVersionRegistry();
  const draft = skills.propose({
    skillId: 'status-check-q11',
    purpose: 'check status',
    goal: 'check status',
    trigger: 'read system status',
    workflow: ['status'],
    verification: ['ok'],
    evidence: ['exp_q11'],
    requiredCapabilities: ['system.status'],
  });
  assert.equal(draft.trustStatus, 'DRAFT');
  assert.equal(skills.retrieveTrusted('read system status').length, 0);
  skills.markTested(draft.skillId, draft.version, true);
  assert.throws(() => skills.trust(draft.skillId, draft.version, 'jarvis'));
  const trusted = skills.trust(draft.skillId, draft.version, 'owner');
  assert.equal(trusted.trustStatus, 'TRUSTED');
  const hits = skills.retrieveTrusted('read system status');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.scriptsAllowed, false);
});

test('10 voice mock interruption classifies stop without persisting audio', async () => {
  const tts = new MockTtsPort({ defer: true });
  const voice = new VoiceInteractionRuntime({ tts });
  voice.listen();
  await voice.transcribe('hello');
  voice.think('hello');
  const pending = voice.speak('I am still talking');
  await waitFor(() => tts.status() === 'speaking', 'tts speaking');
  const barge = await voice.bargeIn('stop');
  assert.equal(barge.interruptionKind, 'stop');
  assert.equal(barge.bargeInActive, true);
  const finished = await pending;
  assert.equal(finished.spoken?.status, 'cancelled');
  assert.equal('pcm' in barge, false);
});

test('11 screen and device observation stays simulated and non-authoritative', async () => {
  const perception = new PerceptionRuntime();
  const capture = await perception.capture('display');
  assert.equal(capture.simulated, true);
  assert.equal(capture.controlGranted, false);
  const vision = perception.interpret({
    description: 'A settings window is visible.',
    objects: [{ id: 'gear', label: 'Settings', confidence: 0.8 }],
  });
  assert.equal(vision.authoritative, false);
  assert.equal(vision.simulated, true);
  const snap = perception.snapshot();
  assert.equal(snap.label, 'SIMULATION');
  assert.equal(snap.liveCamera, false);
  assert.equal(snap.seeImpliesClick, false);
  const presence = deriveGlobalPresence({ perceptionSimulated: true, simulationMode: true });
  assert.equal(presence.presence, 'SIMULATION');
  assert.notEqual(presence.presence, 'REAL');
});

test('12 Night benchmark/review stays simulated and never auto-promotes', () => {
  const experiences = new ExperienceStore();
  experiences.create({
    kind: 'episodic',
    goal: 'Read system status',
    situation: 'owner asked for status',
    actions: ['system.status'],
    tools: ['system.status'],
    result: 'cpu 12',
    outcome: 'success',
    lessons: [],
    confidence: 0.9,
    privacyClass: 'private',
    domain: 'system',
  });
  const skills = new SkillVersionRegistry();
  const traces = new TraceStore();
  const night = new NightCycle({
    experiences,
    skills,
    traces,
    analyzer: new TraceAnalyzer(),
    simulated: true,
    runBenchmarks: () => runCloudBenchmarkBank(new BenchmarkBank()).length,
  });
  const report = night.run();
  assert.equal(report.autoPromoted, false);
  assert.ok(report.benchmarksRun > 0);
  assert.equal(report.simulated, true);
  assert.equal(report.traceEvidence, 'INSUFFICIENT_DATA');
});

test('13 native helper unavailable stays UNSUPPORTED_HOST and is not live', () => {
  const helper = new FakeNativeJarvisHelper({ available: false, runtimeId: 'rt-q11', sessionId: 'sess-q11' });
  const health = helper.health();
  assert.equal(health.status, 'unavailable');
  assert.equal(health.reasonCode, 'UNSUPPORTED_HOST');
  const closed = helper.handle({ protocolVersion: NATIVE_HELPER_PROTOCOL_VERSION, command: 'HEALTH' });
  assert.equal(closed.ok, false);
  assert.equal(closed.reasonCode, 'UNSUPPORTED_HOST');
  assert.equal(classifyFailure({ reasonCode: health.reasonCode }), 'UNSUPPORTED_HOST');
  const gap = displayForWindow(
    [
      {
        id: 'd1',
        name: 'left',
        aliases: [],
        primary: true,
        ownerNamed: false,
        bounds: { x: -3600, y: 0, width: 1600, height: 900 },
        workingArea: { x: -3600, y: 0, width: 1600, height: 900 },
      },
      {
        id: 'd2',
        name: 'right',
        aliases: [],
        primary: false,
        ownerNamed: false,
        bounds: { x: 0, y: 0, width: 1600, height: 900 },
        workingArea: { x: 0, y: 0, width: 1600, height: 900 },
      },
    ],
    { x: -1800, y: 0, width: 1400, height: 900 },
  );
  assert.equal(gap, undefined);
  assert.equal(classifyFailure({ reasonCode: 'UNKNOWN_DISPLAY' }), 'UNKNOWN_DISPLAY');
});

test('14 RESTRICTED models are never auto-selected even as owner preference', () => {
  const profiles = new ModelProfileRegistry();
  const uncensored = profiles.get('qwen38-27b-uncensored');
  assert.equal(uncensored?.trustTier, 'RESTRICTED');
  assert.equal(neverAutoSelectRestricted(uncensored!), true);
  const decision = routeModelProfile({
    intent: 'casual',
    profiles,
    hardware: { preferredModelId: 'qwen38-27b-uncensored' },
  });
  assert.equal(decision.restrictedSelected, false);
  assert.notEqual(decision.modelProfileId, 'qwen38-27b-uncensored');
  assert.ok(catalogModelProfiles().every(item => item.securityAuthority === false));
});

test('Command Center intelligence stays INSUFFICIENT_DATA without traces and is not LIVE', () => {
  const intelligence = presentIntelligence({
    simulationMode: true,
    visualState: 'IDLE',
    visualLabel: 'IDLE',
    control: { simulationMode: true, maxAutonomy: 'suggest' },
    request: { empty: true, route: null, requestId: null, socialAction: null, agentic: false, reason: null },
    evolution: { benchmarks: [], candidates: [] },
    intelligence: {
      traces: { count: 0, recent: [] },
      analyzer: { status: 'INSUFFICIENT_DATA', reason: 'No traces to measure.', sampleCount: 0 },
      runtimeSpec: { id: 'spec', version: 1 },
      specCandidates: [],
      models: [],
      certifications: [],
      efficiency: { status: 'INSUFFICIENT_DATA' },
      artifacts: [],
      scheduler: { schedulers: [], coordinatorIsScheduler: false },
      productionPromotionAllowed: false,
    },
  } as never);
  assert.equal(intelligence.insufficientData, true);
  assert.match(intelligence.insufficientLabel, /INSUFFICIENT_DATA|No traces/i);
  assert.equal(classifyFailure({ reasonCode: 'INSUFFICIENT_DATA' }), 'INSUFFICIENT_DATA');
});

test('WorkAgent receive preserves correlation through Command Center traces', async () => {
  const host = testHost({
    'system.status': () => result('system.status', { content: 'ok' }),
  });
  const center = new CommandCenterRuntime({
    host,
    persistRoot: tempRoot('jarvis-q11-corr-'),
  });
  const ids = createCorrelationIds({ sessionId: 'q11-cc', requestId: 'req-cc', turnId: 'turn-cc' });
  const task = await center.runObjective('Read system status', {
    sessionId: ids.sessionId,
    requestId: ids.requestId,
    turnId: ids.turnId,
    capabilityId: 'system.status',
  });
  assert.equal(task.sessionId, ids.sessionId);
  assert.equal(task.requestId, ids.requestId);
  assert.equal(task.turnId, ids.turnId);
  const trace = center.traces.list(1)[0];
  assert.ok(trace);
  assert.equal(trace.sessionId, ids.sessionId);
  assert.equal(trace.requestId, ids.requestId);
  assert.equal(trace.turnId, ids.turnId);
  assert.equal(trace.taskId, task.id);
  assert.ok(trace.stepId);
  const request = createJarvisRequest({
    text: 'Read system status',
    requestId: ids.requestId,
    sessionId: ids.sessionId,
  });
  assert.equal(request.requestId, ids.requestId);
  assert.equal(request.clientContext.sessionId, ids.sessionId);
  center.agent.store.close();
  center.persistence?.close();
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  AffectEngine,
  CandidateManager,
  CapabilitySelfModel,
  ClaimStore,
  ExperienceStore,
  FailureLedger,
  GrowthPlanner,
  ModelAdaptationRegistry,
  NightCycle,
  PracticeEngine,
  SkillVersionRegistry,
  affectCannotAuthorize,
  buildJournal,
  createCandidateSandbox,
  reflectStructured,
  rejectProductionWrite,
  resolveMemoryContradiction,
} from '../src/jarvis';
import { measureRetrieval, rankRetrieval } from '../src/jarvis/evolution/retrievalQuality';
import { CORE_IDENTITY, coreIdentityMutable } from '../src/jarvis/evolution/identity';
import { MODEL_ADAPTATION_ORDER } from '../src/jarvis/evolution/modelAdaptation';

test('owner-confirmed claims supersede and webpages cannot write', () => {
  const store = new ClaimStore(() => 1_000);
  const first = store.put({
    factKey: 'laptop.gpu',
    statement: 'Laptop GPU = X',
    source: 'observation',
    confidence: 0.5,
    status: 'OBSERVED',
    actor: 'system',
  });
  const second = store.put({
    factKey: 'laptop.gpu',
    statement: 'Laptop GPU = Y',
    source: 'owner',
    confidence: 1,
    status: 'OWNER_CONFIRMED',
    actor: 'owner',
  });
  assert.equal(store.get(first.id)?.status, 'SUPERSEDED');
  assert.equal(store.get(first.id)?.supersededBy, second.id);
  assert.equal(store.activeByKey('laptop.gpu')?.statement, 'Laptop GPU = Y');
  assert.throws(() => store.put({
    factKey: 'laptop.gpu',
    statement: 'Laptop GPU = Z',
    source: 'web',
    confidence: 0.9,
    status: 'WEB_VERIFIED',
    actor: 'webpage',
  }));
  assert.equal(resolveMemoryContradiction(
    { id: 'm1', statement: 'GPU = X', confidence: 0.4, kind: 'semantic' },
    { id: 'm2', statement: 'GPU = Y', confidence: 1, kind: 'semantic' },
    'owner',
  ).action, 'prefer_newer_if_same_kind');
});

test('stale claims leave the active set', () => {
  let now = 1_000;
  const store = new ClaimStore(() => now);
  store.put({
    factKey: 'product.price',
    statement: 'Price is 10',
    source: 'system',
    confidence: 0.4,
    status: 'OBSERVED',
    actor: 'system',
  });
  now += 2 * 24 * 60 * 60_000;
  assert.equal(store.active().length, 0);
  assert.equal(store.list()[0]?.status, 'STALE');
});

test('failure reflection cannot create a trusted-success skill', () => {
  const experiences = new ExperienceStore(() => 1);
  const skills = new SkillVersionRegistry();
  const failed = experiences.create({
    kind: 'episodic',
    domain: 'research',
    goal: 'fetch source',
    situation: 'timeout',
    actions: ['fetch'],
    tools: ['research.fetchSource'],
    result: 'timeout',
    outcome: 'failure',
    lessons: [],
    confidence: 0.3,
    privacyClass: 'private',
    cause: 'RESEARCH_TIMEOUT',
  });
  const reflection = reflectStructured(failed, experiences.similarFailures('RESEARCH_TIMEOUT'), 'important_failure');
  assert.equal(reflection.outcome, 'failure');
  assert.equal(reflection.skillCandidateAllowed, false);
  assert.match(reflection.skillChange, /No trusted-success skill/u);
  if (reflection.skillCandidateAllowed) {
    skills.propose({
      skillId: 'should-not-happen',
      purpose: 'x',
      trigger: 'x',
      prerequisites: [],
      workflow: [],
      failureModes: [],
      recovery: [],
      safetyConstraints: [],
      verification: [],
      evidence: [],
    });
  }
  assert.equal(skills.list().length, 0);
});

test('skill versions stay instruction-only and can be rejected without touching production', () => {
  const registry = new SkillVersionRegistry();
  const v1 = registry.propose({
    skillId: 'windows-audio-debug',
    purpose: 'debug audio',
    trigger: 'crackle',
    prerequisites: [],
    workflow: ['check official notes'],
    failureModes: ['timeout'],
    recovery: ['retry official'],
    safetyConstraints: ['scriptsAllowed=false'],
    verification: ['unit'],
    evidence: ['exp_1'],
  });
  assert.equal(v1.status, 'CANDIDATE');
  assert.equal(v1.scriptsAllowed, false);
  registry.markTested(v1.skillId, v1.version, true);
  registry.promote(v1.skillId, v1.version, true);
  const v2 = registry.propose({
    skillId: 'windows-audio-debug',
    purpose: 'debug audio',
    trigger: 'crackle',
    prerequisites: [],
    workflow: ['guess a forum'],
    failureModes: ['wrong driver'],
    recovery: ['rollback'],
    safetyConstraints: ['scriptsAllowed=false'],
    verification: ['must stay worse'],
    evidence: ['exp_2'],
    parentVersion: 1,
  });
  registry.markTested(v2.skillId, v2.version, false);
  const rejected = registry.reject(v2.skillId, v2.version, 'worse than known-good');
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(registry.knownGoodVersion(v1.skillId)?.version, 1);
});

test('retrieval ranking drops stale, duplicate, and wrong-person items', () => {
  const ranked = rankRetrieval([
    { id: 'a', text: 'Spin likes Valorant', personId: 'spin', projectId: 'jarvis', confidence: 0.9, importance: 0.8, recencyMs: 1_000 },
    { id: 'b', text: 'Spin likes Valorant', personId: 'spin', projectId: 'jarvis', confidence: 0.9, importance: 0.8, recencyMs: 2_000 },
    { id: 'c', text: 'Someone else likes Valorant', personId: 'other', projectId: 'jarvis', confidence: 0.9, importance: 0.9, recencyMs: 500 },
    { id: 'd', text: 'Old valorant note', personId: 'spin', projectId: 'other', confidence: 0.4, importance: 0.2, recencyMs: 1, stale: true },
  ], { text: 'valorant', personId: 'spin', projectId: 'jarvis', limit: 3 });
  assert.equal(ranked[0]?.id, 'a');
  assert.ok(!ranked.some(item => item.id === 'b'), 'duplicate dropped');
  const metrics = measureRetrieval(ranked, ['a'], { personId: 'spin', projectId: 'jarvis' });
  assert.ok(metrics.precision > 0);
  assert.equal(metrics.duplicates, 0);
});

test('self-model stays insufficient until enough evidence exists', () => {
  const model = new CapabilitySelfModel(() => 1);
  const first = model.observe('research.search', 'success', undefined, { verificationState: 'VERIFIED', evidenceRefs: ['test:1'] });
  assert.equal(first.recentTrend, 'insufficient_data');
  assert.equal(first.confidence, null);
  model.observe('research.search', 'success', undefined, { verificationState: 'VERIFIED', evidenceRefs: ['test:2'] });
  const third = model.observe('research.search', 'success', undefined, { verificationState: 'VERIFIED', evidenceRefs: ['test:3'] });
  assert.equal(third.recentTrend, 'improving');
  assert.ok(third.confidence !== null);
});

test('night cycle pauses under realtime voice and can cancel', () => {
  const experiences = new ExperienceStore(() => 1);
  experiences.create({
    kind: 'episodic',
    goal: 'demo',
    situation: 'ok',
    actions: [],
    tools: ['task'],
    result: 'ok',
    outcome: 'success',
    lessons: ['x'],
    confidence: 0.8,
    privacyClass: 'private',
    significance: 0.6,
  });
  let priority: 'realtime_voice' | 'background_evolution' = 'realtime_voice';
  const night = new NightCycle({
    experiences,
    resource: () => priority,
    simulated: true,
  });
  const paused = night.run();
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pausedFor, 'realtime_voice');
  priority = 'background_evolution';
  night.resume();
  const done = night.run();
  assert.equal(done.status, 'completed');
  const cancellable = new NightCycle({ experiences, simulated: true });
  cancellable.cancel();
  assert.equal(cancellable.snapshot().status, 'cancelled');
});

test('affect decays and cannot authorize tools', () => {
  const affect = new AffectEngine();
  affect.appraise({ kind: 'failure', intensity: 1 });
  const after = affect.snapshot();
  affect.decay(8);
  assert.ok(Math.abs(affect.snapshot().valence) < Math.abs(after.valence) || affect.snapshot().valence > after.valence);
  const style = affect.style();
  assert.equal(affectCannotAuthorize(style), true);
  assert.equal(coreIdentityMutable(), false);
  assert.equal(CORE_IDENTITY.notConscious, true);
});

test('self-improvement rejects a bad candidate and never auto-promotes production', () => {
  const sandbox = createCandidateSandbox();
  const manager = new CandidateManager();
  const bad = manager.create({ hypothesis: 'skip tests', sandboxPath: sandbox, simulated: true });
  const failed = manager.evaluate(bad.id, { benchmarkBefore: 0.9, benchmarkAfter: 0.2, testsPassed: false, securityPassed: true });
  assert.equal(failed.status, 'FAILED');
  const good = manager.create({ hypothesis: 'prefer official sources', sandboxPath: sandbox, simulated: true });
  const promoted = manager.evaluate(good.id, { benchmarkBefore: 0.5, benchmarkAfter: 0.8, testsPassed: true, securityPassed: true });
  assert.equal(promoted.status, 'PROMOTION_CANDIDATE');
  assert.equal(manager.productionPromotionAllowed(), false);
  assert.throws(() => rejectProductionWrite(`${process.cwd()}/src/jarvis/index.ts`));
  fs.rmSync(sandbox, { recursive: true, force: true });
});

test('growth planner, practice, journal, and model adaptation stay fail-closed', () => {
  const growth = new GrowthPlanner();
  growth.propose({ id: 'g1', title: 'Improve source verification', evidence: 'timeouts', practice: 'research_comparison', metric: 'official_selected', successCondition: '3 official-first runs' });
  growth.propose({ id: 'g2', title: 'Improve memory precision', evidence: 'duplicates', practice: 'memory_conflict', metric: 'precision', successCondition: 'precision >= 0.8' });
  growth.propose({ id: 'g3', title: 'Reduce tool failures', evidence: 'retries', practice: 'tool_failure', metric: 'fail_closed', successCondition: 'no false success' });
  assert.throws(() => growth.propose({ id: 'g4', title: 'Too many', evidence: 'x', practice: 'x', metric: 'x', successCondition: 'x' }) && growth.activate('g4'));
  const practice = new PracticeEngine();
  assert.equal(practice.exercises()[0]?.destructive, false);
  const journal = buildJournal({
    experiences: new ExperienceStore(() => 1).list(),
    goals: growth.list(),
  });
  assert.ok(Array.isArray(journal.newLessons));
  const adaptation = new ModelAdaptationRegistry();
  assert.equal(adaptation.nextLayer('CONTEXT'), 'RETRIEVAL');
  assert.equal(MODEL_ADAPTATION_ORDER.at(-1), 'OPTIONAL_LORA');
  const dataset = adaptation.registerDataset('safe fixtures', 3);
  const candidate = adaptation.proposeCandidate(dataset.id);
  assert.equal(candidate.trained, false);
  const failures = new FailureLedger();
  const exp = new ExperienceStore(() => 1).create({
    kind: 'episodic',
    goal: 'x',
    situation: 'timeout',
    actions: [],
    tools: ['research.fetchSource'],
    result: 'timeout',
    outcome: 'failure',
    lessons: [],
    confidence: 0.2,
    privacyClass: 'private',
    cause: 'RESEARCH_TIMEOUT',
  });
  failures.record(exp, 'RESEARCH_TIMEOUT');
  failures.record(exp, 'RESEARCH_TIMEOUT');
  assert.equal(failures.recurring()[0]?.count, 2);
});

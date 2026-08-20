import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteJarvisMemoryStore } from '../src/bot/memory/jarvis';
import { adaptPlanForFailures } from '../src/jarvis/agent/adaptivePlan';
import { planForObjective } from '../src/jarvis/agent/plans';
import type { WorkTask } from '../src/jarvis/agent/types';
import {
  BenchmarkBank,
  CapabilitySelfModel,
  ExperienceStore,
  FailureLedger,
  ReflectionLedger,
  SkillVersionRegistry,
  applyTaskOutcome,
  classifyFailureKnowledge,
  jarvisMaySelfApproveSkill,
  reflectStructured,
  retrieveRelevantSkills,
  runExperiencePipeline,
  runIsolatedSkillBenchmark,
} from '../src/jarvis/evolution';
import { SKILL_AUTHORITY_STAGES, SKILL_TRUST_STATES } from '../src/jarvis/evolution/skillLifecycleConstants';
import { autoPromoteSkill, productionSkillPromotionAllowed } from '../src/jarvis/evolution/skillTrust';
import { reflectionIsSafe } from '../src/jarvis/evolution/reflectionEngine';

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function workTask(input: {
  id: string;
  objective: string;
  outcome: WorkTask['outcome'];
  status?: WorkTask['status'];
  capability?: string;
  errors?: WorkTask['errors'];
  verification?: WorkTask['verification'];
  evidence?: string[];
  planTitles?: string[];
}): WorkTask {
  const success = input.outcome === 'success';
  const capability = input.capability ?? (success ? 'system.status' : 'research.fetchSource');
  return {
    id: input.id,
    objective: input.objective,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: input.status ?? (success ? 'COMPLETED' : 'FAILED'),
    outcome: input.outcome,
    plan: (input.planTitles ?? ['Understand', 'Apply', 'Verify']).map((title, index) => ({
      id: `step_${index}`,
      title,
      kind: index === 2 ? 'verify' : index === 1 ? 'apply' : 'understand',
      dependencies: index === 0 ? [] : [`step_${index - 1}`],
      status: success ? 'done' : 'failed',
      capability: index === 1 ? capability : undefined,
      riskLevel: 'LOW',
      verificationMethod: 'observation',
      retryPolicy: { maxAttempts: 2, attempted: 0 },
    })),
    evidence: input.evidence ?? [],
    toolResults: [{ capability, status: success ? 'ok' : 'error', summary: success ? 'ok' : 'failed' }],
    permissionRequirements: [],
    retryBudget: 2,
    retriesUsed: success ? 0 : 1,
    errors: input.errors ?? (success ? [] : [{
      at: new Date().toISOString(),
      code: 'STEP_FAILED',
      message: 'failed',
    }]),
    verification: input.verification ?? (success ? { passed: true, summary: 'checks passed' } : undefined),
  };
}

function pipelineStores(memoryStore?: SqliteJarvisMemoryStore) {
  const benchmarks = new BenchmarkBank();
  return {
    experiences: new ExperienceStore(),
    reflections: new ReflectionLedger(),
    failures: new FailureLedger(),
    skills: new SkillVersionRegistry(),
    selfModel: new CapabilitySelfModel(),
    benchmarks,
    memoryStore,
  };
}

test('authority stages stay separated and auto-promote is impossible', () => {
  assert.deepEqual([...SKILL_AUTHORITY_STAGES], ['DISCOVER', 'INSTALL', 'REVIEW', 'TRUST', 'EXECUTE']);
  assert.deepEqual([...SKILL_TRUST_STATES], ['DRAFT', 'REVIEW_REQUIRED', 'TRUSTED', 'REJECTED', 'DEPRECATED']);
  assert.equal(autoPromoteSkill(), false);
  assert.equal(productionSkillPromotionAllowed(), false);
  assert.equal(jarvisMaySelfApproveSkill(), false);
});

test('successful verified task mints a reviewable skill candidate with required fields', () => {
  const stores = pipelineStores();
  const result = runExperiencePipeline(workTask({
    id: 'task_ok1',
    objective: 'Read system status safely',
    outcome: 'success',
  }), stores);
  assert.equal(result.duplicate, undefined);
  assert.equal(result.verified, true);
  assert.equal(result.classification, 'success');
  const skill = result.skillCandidate;
  assert.ok(skill);
  assert.equal(skill.autoPromote, false);
  assert.equal(skill.scriptsAllowed, false);
  assert.equal(skill.trustStatus, 'REVIEW_REQUIRED');
  assert.notEqual(skill.trustStatus, 'TRUSTED');
  for (const key of [
    'id', 'name', 'goal', 'triggerConditions', 'requiredCapabilities', 'steps',
    'prerequisites', 'verification', 'failureModes', 'securityScope', 'evidence', 'version', 'trustStatus',
  ]) {
    assert.ok(key in skill, `missing ${key}`);
  }
  assert.ok(skill.steps.length >= 1);
  assert.ok(skill.verification.length >= 1);
  assert.match(skill.securityScope, /CapabilityHost/u);
  assert.equal(stores.skills.autoPromote(), false);
  assert.equal(stores.skills.retrieveTrusted('Read system status safely').length, 0);
  assert.equal(result.benchmarkCandidate?.passed, true);
  assert.equal(result.benchmarkCandidate?.autoPromote, false);
});

test('failed task does not mint a skill candidate', () => {
  const stores = pipelineStores();
  const result = applyTaskOutcome(workTask({
    id: 'task_fail1',
    objective: 'Fetch driver notes',
    outcome: 'failure',
    capability: 'research.fetchSource',
    errors: [{ at: new Date().toISOString(), code: 'RESEARCH_TIMEOUT', message: 'timeout' }],
  }), stores);
  assert.equal(result.reflection?.skillCandidateAllowed, false);
  assert.equal(result.skillCandidate, null);
  assert.equal(stores.skills.list().length, 0);
  assert.equal(result.failureKnowledge?.kind, 'provider_timeout');
  assert.equal(classifyFailureKnowledge('RESEARCH_TIMEOUT'), 'provider_timeout');
});

test('unverified success does not mint a false skill', () => {
  const stores = pipelineStores();
  const result = runExperiencePipeline(workTask({
    id: 'task_unverified',
    objective: 'Claim success without proof',
    outcome: 'success',
    verification: { passed: false, summary: 'checks failed' },
  }), stores);
  assert.equal(result.classification, 'failure');
  assert.equal(result.skillCandidate, null);
  assert.equal(result.failureKnowledge?.kind, 'verification_failed');
  assert.equal(stores.skills.list().length, 0);
});

test('experience pipeline is idempotent for one task lifecycle', () => {
  const stores = pipelineStores();
  const task = workTask({
    id: 'task_once',
    objective: 'Inspect runtime status',
    outcome: 'success',
  });
  const first = runExperiencePipeline(task, stores);
  const second = runExperiencePipeline(task, stores);
  assert.equal(second.duplicate, true);
  assert.equal(stores.experiences.list().length, 1);
  assert.equal(stores.skills.list().length, 1);
  assert.equal(first.skillCandidate?.id, second.skillCandidate?.id);
  assert.equal(stores.reflections.list().filter(item => item.experienceId === first.experience?.id).length, 1);
});

test('only trusted skills are retrieved; rejected and deprecated are excluded', () => {
  const skills = new SkillVersionRegistry();
  const draft = skills.propose({
    skillId: 'status-check',
    purpose: 'check status',
    goal: 'check status',
    trigger: 'read system status',
    workflow: ['status'],
    verification: ['ok'],
    evidence: ['exp_a'],
    requiredCapabilities: ['system.status'],
  });
  assert.equal(draft.trustStatus, 'DRAFT');
  assert.equal(skills.retrieveTrusted('read system status').length, 0);
  const reviewed = skills.markTested(draft.skillId, draft.version, true);
  assert.equal(reviewed.trustStatus, 'REVIEW_REQUIRED');
  assert.equal(skills.retrieveTrusted('read system status').length, 0);
  assert.throws(() => skills.trust(draft.skillId, draft.version, 'jarvis'), /never approve/u);
  assert.throws(() => skills.trust(draft.skillId, draft.version, 'skill'), /never approve/u);
  const trusted = skills.trust(draft.skillId, draft.version, 'owner');
  assert.equal(trusted.trustStatus, 'TRUSTED');
  const hits = skills.retrieveTrusted('read system status');
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.trustStatus, 'TRUSTED');
  const retrieved = retrieveRelevantSkills(skills.list(), 'read system status');
  assert.equal(retrieved[0]?.authority, 'plan_only');
  assert.equal(retrieved[0]?.overridesCapabilityHost, false);

  const other = skills.propose({
    skillId: 'bad-plan',
    purpose: 'open settings',
    trigger: 'change this system setting',
    workflow: ['settings'],
    verification: ['ok'],
    evidence: ['exp_b'],
  });
  skills.markTested(other.skillId, other.version, true);
  skills.trust(other.skillId, other.version, 'owner');
  skills.deprecate(other.skillId, other.version);
  assert.ok(!skills.retrieveTrusted('change this system setting').some(item => item.skillId === 'bad-plan'));
  assert.equal(skills.get(other.skillId, other.version)?.trustStatus, 'DEPRECATED');

  const rejected = skills.propose({
    skillId: 'rejected-skill',
    purpose: 'read system status again',
    trigger: 'read system status',
    workflow: ['nope'],
    verification: ['ok'],
    evidence: ['exp_c'],
  });
  skills.reject(rejected.skillId, rejected.version, 'owner rejected');
  assert.ok(skills.retrieveTrusted('read system status').every(item => item.trustStatus === 'TRUSTED'));
});

test('isolated benchmark rejects forbidden shell and never auto-promotes', () => {
  const skills = new SkillVersionRegistry();
  const bank = new BenchmarkBank();
  const unsafe = skills.propose({
    skillId: 'unsafe-shell',
    purpose: 'run shell',
    trigger: 'run a command',
    workflow: ['shell.exec'],
    requiredCapabilities: ['shell.exec'],
    verification: ['none'],
    evidence: ['exp_shell'],
  });
  const bench = runIsolatedSkillBenchmark(skills, unsafe, bank);
  assert.equal(bench.passed, false);
  assert.equal(bench.autoPromote, false);
  assert.equal(bench.trustStatusAfter, 'REJECTED');
  assert.equal(skills.retrieveTrusted('run a command').length, 0);
  assert.equal(skills.autoPromote(), false);
  assert.equal(skills.productionPromotionAllowed(), false);
  assert.equal(skills.selfApprove(), false);
});

test('failure adaptation avoids known failures without granting new authority', () => {
  const experiences = new ExperienceStore();
  const ledger = new FailureLedger();
  for (let i = 0; i < 2; i += 1) {
    ledger.record(experiences.create({
      kind: 'episodic',
      domain: 'task',
      goal: 'open settings',
      situation: 'open settings',
      actions: ['apply'],
      tools: ['desktop.openSettings'],
      result: 'denied',
      outcome: 'failure',
      lessons: [],
      confidence: 0.4,
      privacyClass: 'private',
      significance: 0.8,
      cause: 'PERMISSION_REQUIRED',
      failureKind: 'owner_denied',
    }), 'PERMISSION_REQUIRED');
  }
  const original = planForObjective('change this system setting', 'desktop.openSettings');
  const adapted = adaptPlanForFailures(original, ledger, []);
  const gated = adapted.find(step => step.capability === 'desktop.openSettings');
  assert.ok(gated);
  assert.equal(gated?.capability, 'desktop.openSettings');
  assert.equal(gated?.retryPolicy.maxAttempts, 1);
  assert.match(gated?.title || '', /owner_denied/u);
  assert.equal(adapted.length, original.length);
  assert.ok(!adapted.some(step => step.capability === 'shell.exec'));
});

test('Jarvis cannot self-approve a skill after isolated review', () => {
  const stores = pipelineStores();
  const result = runExperiencePipeline(workTask({
    id: 'task_review',
    objective: 'Read system status',
    outcome: 'success',
  }), stores);
  const skill = result.skillCandidate;
  assert.ok(skill);
  assert.equal(skill.trustStatus, 'REVIEW_REQUIRED');
  assert.throws(() => stores.skills.trust(skill.skillId, skill.version, 'jarvis'));
  assert.throws(() => stores.skills.trust(skill.skillId, skill.version, 'model'));
  assert.equal(stores.skills.get(skill.skillId, skill.version)?.trustStatus, 'REVIEW_REQUIRED');
  stores.skills.trust(skill.skillId, skill.version, 'owner');
  assert.equal(stores.skills.get(skill.skillId, skill.version)?.trustStatus, 'TRUSTED');
});

test('reflection is structured outcome analysis without chain-of-thought', () => {
  const experiences = new ExperienceStore();
  const failed = experiences.create({
    kind: 'episodic',
    goal: 'fetch',
    situation: 'timeout',
    actions: ['research'],
    tools: ['research.fetchSource'],
    result: 'timeout',
    outcome: 'failure',
    lessons: [],
    confidence: 0.3,
    privacyClass: 'private',
    cause: 'RESEARCH_TIMEOUT',
  });
  const reflection = reflectStructured(failed, [], 'important_failure');
  assert.equal(reflectionIsSafe(reflection), true);
  assert.equal(reflection.skillCandidateAllowed, false);
  const keys = Object.keys(reflection);
  assert.ok(!keys.some(key => /chain|scratch|cot|hidden/iu.test(key)));
  assert.ok(keys.includes('happened'));
  assert.ok(keys.includes('failed'));
  assert.ok(keys.includes('cause'));
});

test('episode pipeline writes a memory candidate that is not owner-trusted', () => {
  const root = tempRoot('jarvis-skills-v2-mem-');
  const memory = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  try {
    const stores = pipelineStores(memory);
    const result = runExperiencePipeline(workTask({
      id: 'task_mem1',
      objective: 'Read system status',
      outcome: 'success',
    }), stores);
    assert.ok(result.memoryCandidate);
    assert.equal(result.memoryCandidate?.ownerTrusted, false);
    assert.notEqual(result.memoryCandidate?.status, 'accepted');
  } finally {
    memory.close();
  }
});

test('untrusted research experience cannot become a trusted skill', () => {
  const root = tempRoot('jarvis-skills-v2-research-');
  const memory = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  try {
    const stores = pipelineStores(memory);
    const result = runExperiencePipeline(workTask({
      id: 'task_research_fail',
      objective: 'Fetch public notes',
      outcome: 'failure',
      capability: 'research.fetchSource',
      evidence: ['untrusted:web'],
      errors: [{ at: new Date().toISOString(), code: 'RESEARCH_TIMEOUT', message: 'timeout' }],
    }), stores);
    assert.equal(result.skillCandidate, null);
    assert.equal(stores.skills.list().length, 0);
    assert.equal(result.memoryCandidate?.ownerTrusted, false);
    assert.equal(result.memoryCandidate?.status, 'rejected');
  } finally {
    memory.close();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AgentRuntimeLearningBridge,
  RuntimeLearningError,
} from '../src/jarvis/runtime';
import {
  CapabilitySelfModel,
  ExperienceStore,
  FailureLedger,
  ReflectionLedger,
  SkillVersionRegistry,
} from '../src/jarvis/evolution';

function stores() {
  return {
    experiences: new ExperienceStore(() => Date.UTC(2026, 7, 28)),
    reflections: new ReflectionLedger(),
    failures: new FailureLedger(),
    skills: new SkillVersionRegistry(),
    selfModel: new CapabilitySelfModel(() => Date.UTC(2026, 7, 28)),
  };
}
test('Hermes completion cannot become learned success without JARVIS verification', () => {
  const state = stores();
  const bridge = new AgentRuntimeLearningBridge(state);
  assert.throws(() => bridge.recordVerifiedOutcome({
    run: { runId: 'run_unverified', status: 'completed', output: 'MODEL_PRIVATE_OUTPUT' },
    objective: 'Inspect runtime behavior',
    outcome: 'success',
    verification: { state: 'UNVERIFIED', summary: 'Hermes said it finished.', evidence: [] },
  }), (error: unknown) => error instanceof RuntimeLearningError
    && error.reasonCode === 'RUNTIME_LEARNING_UNVERIFIED_SUCCESS');
  assert.equal(state.experiences.list().length, 0);
  assert.equal(state.skills.list().length, 0);
});

test('verified Hermes success creates experience and candidate skill without persisting raw output', () => {
  const state = stores();
  const bridge = new AgentRuntimeLearningBridge(state);
  const record = bridge.recordVerifiedOutcome({
    run: { runId: 'run_verified', status: 'completed', output: 'MODEL_PRIVATE_OUTPUT_DO_NOT_STORE' },
    objective: 'Read project configuration safely',
    outcome: 'success',
    verification: { state: 'VERIFIED', summary: 'Configuration matched expected project scope.', evidence: ['check:scope'] },
    observedTools: ['mcp__serena_jarvis_hermes__get_current_config'],
    workflow: ['Read current Serena configuration', 'Verify active project scope'],
  });
  assert.equal(record.skillCandidates.length, 1);
  assert.equal(record.skillCandidates[0]?.status, 'CANDIDATE');
  assert.equal(record.autoPromotion, false);
  assert.equal(record.rawRuntimeOutputPersisted, false);
  const persisted = JSON.stringify({ experiences: state.experiences.list(), skills: state.skills.list() });
  assert.doesNotMatch(persisted, /MODEL_PRIVATE_OUTPUT_DO_NOT_STORE/u);
  assert.equal(state.skills.list()[0]?.knownGood, false);
});

test('runtime learning is idempotent for the same Hermes run', () => {
  const state = stores();
  const bridge = new AgentRuntimeLearningBridge(state);
  const input = {
    run: { runId: 'run_duplicate', status: 'completed' as const },
    objective: 'Verify duplicate learning',
    outcome: 'success' as const,
    verification: { state: 'VERIFIED' as const, summary: 'Verified once.', evidence: ['check:once'] },
    workflow: ['Perform verified operation'],
  };
  bridge.recordVerifiedOutcome(input);
  const second = bridge.recordVerifiedOutcome(input);
  assert.equal(second.lifecycle.duplicate, true);
  assert.equal(state.experiences.list().length, 1);
  assert.equal(state.skills.list().length, 1);
});

test('failed Hermes outcome records learning but never proposes a trusted-success skill', () => {
  const state = stores();
  const bridge = new AgentRuntimeLearningBridge(state);
  const record = bridge.recordVerifiedOutcome({
    run: { runId: 'run_failed', status: 'failed', error: 'provider error' },
    objective: 'Attempt a bounded task',
    outcome: 'failure',
    verification: { state: 'FAILED_VERIFICATION', summary: 'Expected postcondition was absent.', evidence: ['check:failed'] },
    observedTools: ['terminal'],
  });
  assert.equal(record.lifecycle.experience?.outcome, 'failure');
  assert.equal(record.skillCandidates.length, 0);
  assert.equal(state.skills.list().length, 0);
});
test('skill promotion requires isolated evaluation and explicit owner action', () => {
  const state = stores();
  const bridge = new AgentRuntimeLearningBridge(state);
  const learned = bridge.recordVerifiedOutcome({
    run: { runId: 'run_promote', status: 'completed' },
    objective: 'Inspect project scope safely',
    outcome: 'success',
    verification: { state: 'VERIFIED', summary: 'Scope verified.', evidence: ['check:scope'] },
    workflow: ['Inspect scope', 'Verify scope'],
  });
  const skill = learned.skillCandidates[0]!;
  const tested = bridge.evaluateSkillCandidate(skill.skillId, skill.version, {
    isolated: true,
    testsPassed: true,
    securityPassed: true,
    benchmarkBefore: 0.6,
    benchmarkAfter: 0.8,
  });
  assert.equal(tested.status, 'TESTED');
  assert.throws(() => bridge.promoteSkillCandidate('system', skill.skillId, skill.version),
    (error: unknown) => error instanceof RuntimeLearningError
      && error.reasonCode === 'RUNTIME_SKILL_OWNER_REQUIRED');
  const active = bridge.promoteSkillCandidate('owner', skill.skillId, skill.version);
  assert.equal(active.status, 'ACTIVE');
  assert.equal(active.knownGood, true);
});

test('failed isolated evaluation rejects the candidate', () => {
  const state = stores();
  const bridge = new AgentRuntimeLearningBridge(state);
  const skill = state.skills.propose({
    skillId: 'candidate', purpose: 'candidate', trigger: 'candidate', prerequisites: [],
    workflow: ['step'], failureModes: [], recovery: [], safetyConstraints: ['no auto-promote'],
    verification: ['fixture'], evidence: ['fixture:1'],
  });
  const evaluated = bridge.evaluateSkillCandidate(skill.skillId, skill.version, {
    isolated: false, testsPassed: true, securityPassed: true, benchmarkBefore: 0.4, benchmarkAfter: 0.9,
  });
  assert.equal(evaluated.status, 'REJECTED');
});

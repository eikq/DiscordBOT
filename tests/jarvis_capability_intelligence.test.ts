import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CapabilityGapResolver,
  CapabilityRegistry,
  ModelCertificationRegistry,
  ModelProfileRegistry,
  WorkAgent,
  advanceCapabilityCandidate,
  answerFromSelfKnowledge,
  approveCapabilityCandidate,
  buildSelfKnowledgeSnapshot,
  coreSecurityIsDistributionInvariant,
  discoverCapabilityCandidate,
  distributionForCapability,
  enableCapabilityCandidate,
  markCapabilityCandidateInstalled,
  markCapabilityCandidateRegistered,
  resolveCapabilityGoal,
  type CapabilityDescriptor,
  type CapabilityHandler,
  type GapResolutionPlan,
  type PlanStep,
} from '../src/jarvis';
import { CapabilitySelfModel } from '../src/jarvis/evolution/selfModel';
import { FailureLedger } from '../src/jarvis/evolution/failureLearning';
import type { ExperienceRecord } from '../src/jarvis/evolution/types';
import {
  CCTV_CONNECT_GOAL,
  SimulatedDeviceProvider,
  cctvCapabilityContracts,
  validateCctvConnectionProfile,
} from '../src/jarvis/devices';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';

test('Self Knowledge lists a registered available capability from runtime evidence', async () => {
  const host = hostWith(descriptor('system.inspect'), 'up');
  const snapshot = await buildSelfKnowledgeSnapshot({ host });
  const capability = snapshot.capabilities.find(item => item.id === 'system.inspect');
  assert.equal(capability?.registered, true);
  assert.equal(capability?.status, 'AVAILABLE');
  assert.deepEqual(capability?.evidence, ['registry:system.inspect', 'availability:up']);
});

test('Self Knowledge redacts credentials embedded in provider availability evidence', async () => {
  const host = hostWith(descriptor('cctv.status'), 'not_configured', 'Provider rtsp://owner:credential@192.0.2.10 unavailable.');
  const serialized = JSON.stringify(await buildSelfKnowledgeSnapshot({ host }));
  assert.equal(serialized.includes('owner:credential'), false);
  assert.match(serialized, /\[REDACTED\]/);
});

test('missing capability is never hallucinated as available', async () => {
  const snapshot = await buildSelfKnowledgeSnapshot({ host: new CapabilityRegistry() });
  const graph = resolveCapabilityGoal({
    id: 'goal.missing',
    title: 'Use missing capability',
    dependencies: [{ capabilityId: 'missing.tool', relation: 'REQUIRED' }],
  }, snapshot);
  assert.equal(graph.ready, false);
  assert.equal(graph.missing[0]?.status, 'UNSUPPORTED');
  assert.equal(snapshot.capabilities.some(item => item.id === 'missing.tool'), false);
});

test('simulation capability remains SIMULATION even when its handler reports up', async () => {
  const host = hostWith(descriptor('vision.simulated', {
    intelligence: { maturity: 'SIMULATION', executionMode: 'SIMULATION' },
  }), 'up');
  const capability = (await buildSelfKnowledgeSnapshot({ host })).capabilities[0];
  assert.equal(capability?.status, 'SIMULATION');
  assert.equal(capability?.implementation.mode, 'SIMULATION');
});

test('BLOCKED_LOCAL_ACCEPTANCE remains distinct from runtime unavailable', async () => {
  const host = hostWith(descriptor('screen.capture', {
    intelligence: { localAcceptance: 'BLOCKED_LOCAL_ACCEPTANCE' },
  }), 'unavailable');
  const capability = (await buildSelfKnowledgeSnapshot({ host })).capabilities[0]!;
  assert.equal(capability.status, 'UNAVAILABLE');
  assert.equal(capability.localAcceptance, 'BLOCKED_LOCAL_ACCEPTANCE');
});

test('Gap Resolver selects one existing registered capability', async () => {
  const snapshot = await buildSelfKnowledgeSnapshot({ host: hostWith(descriptor('workspace.search'), 'up') });
  const graph = resolveCapabilityGoal({
    id: 'goal.search',
    title: 'Search workspace',
    dependencies: [{ capabilityId: 'workspace.search', relation: 'REQUIRED' }],
  }, snapshot);
  const plan = await new CapabilityGapResolver().resolve({ objective: 'Search workspace', graph, snapshot });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.recommendedPath?.kind, 'USE_EXISTING_CAPABILITY');
  assert.deepEqual(plan.recommendedPath?.capabilityIds, ['workspace.search']);
});

test('Gap Resolver selects an evidence-backed composed path', async () => {
  const host = new CapabilityRegistry();
  host.register(handler(descriptor('workspace.search'), 'up'));
  host.register(handler(descriptor('research.compare'), 'up'));
  const snapshot = await buildSelfKnowledgeSnapshot({ host });
  const graph = resolveCapabilityGoal({
    id: 'goal.compose',
    title: 'Search and compare',
    dependencies: [
      { capabilityId: 'workspace.search', relation: 'REQUIRED' },
      { capabilityId: 'research.compare', relation: 'REQUIRED' },
    ],
  }, snapshot);
  const plan = await new CapabilityGapResolver().resolve({ objective: 'Search and compare', graph, snapshot });
  assert.equal(plan.recommendedPath?.kind, 'COMPOSE_EXISTING_CAPABILITIES');
  assert.deepEqual(plan.recommendedPath?.capabilityIds, ['workspace.search', 'research.compare']);
});

test('missing provider produces NEEDS_PROVIDER without pretending the contract is registered', async () => {
  const snapshot = await buildSelfKnowledgeSnapshot({ declarations: cctvCapabilityContracts() });
  const connect = snapshot.capabilities.find(item => item.id === 'cctv.connect')!;
  assert.equal(connect.status, 'NEEDS_PROVIDER');
  assert.equal(connect.registered, false);
  assert.equal(connect.implementation.maturity, 'PREPARE_CONTRACT');
});

test('missing owner data produces NEEDS_OWNER_INPUT', async () => {
  const snapshot = await buildSelfKnowledgeSnapshot({ declarations: cctvCapabilityContracts() });
  assert.equal(snapshot.capabilities.find(item => item.id === 'cctv.discover')?.status, 'NEEDS_OWNER_INPUT');
});

test('permission requirement is surfaced but never granted by Self Knowledge', async () => {
  const host = hostWith(descriptor('owner.write', {
    sideEffect: 'write',
    intelligence: { permission: 'OWNER_REQUIRED' },
  }), 'up');
  const snapshot = await buildSelfKnowledgeSnapshot({ host });
  const graph = resolveCapabilityGoal({
    id: 'goal.owner-write',
    title: 'Owner write',
    dependencies: [{ capabilityId: 'owner.write', relation: 'REQUIRED' }],
  }, snapshot);
  const plan = await new CapabilityGapResolver().resolve({ objective: 'Owner write', graph, snapshot });
  assert.equal(plan.status, 'NEEDS_OWNER');
  assert.deepEqual(plan.permissionRequired, ['owner.write']);
  assert.equal(snapshot.capabilities[0]?.permission.authorityGranted, false);
});

test('discovery is not review, install, trust, or execution', () => {
  const candidate = discoverCapabilityCandidate({ id: 'cand_1', capabilityId: 'document.parse', source: 'https://owner:credential@example.invalid' });
  assert.equal(candidate.state, 'DISCOVERED');
  assert.equal(candidate.trusted, false);
  assert.equal(candidate.installed, false);
  assert.equal(candidate.executable, false);
  assert.equal(JSON.stringify(candidate).includes('owner:credential'), false);
});

test('candidate capability cannot self-promote', () => {
  let candidate = discoverCapabilityCandidate({ id: 'cand_2', capabilityId: 'document.parse', source: 'metadata' });
  while (candidate.state !== 'OWNER_APPROVAL_REQUIRED') candidate = advanceCapabilityCandidate(candidate, `evidence:${candidate.state}`);
  assert.throws(() => approveCapabilityCandidate(candidate, 'jarvis', 'self approval'), /Only the owner/);
  const approved = approveCapabilityCandidate(candidate, 'owner', 'owner approval:proposal-1');
  assert.throws(() => markCapabilityCandidateInstalled(approved, 'model', 'model says installed'), /reviewed installation/);
  assert.throws(() => markCapabilityCandidateRegistered(approved, 'model', 'model says ready'), /reviewed runtime/);
});

test('unverified success does not increase verified competence', () => {
  const model = new CapabilitySelfModel(() => 1);
  const assessment = model.observe('research.search', 'success', undefined, {
    verificationState: 'UNVERIFIED',
    evidenceRefs: ['task:unverified'],
  });
  assert.equal(assessment.verifiedSuccesses, 0);
  assert.equal(assessment.unverifiedSuccesses, 1);
  assert.equal(assessment.confidence, null);
});

test('verified outcomes update CapabilitySelfModel and deduplicate evidence', () => {
  const model = new CapabilitySelfModel(() => 1);
  for (let index = 0; index < 3; index += 1) {
    model.observe('operator.sandbox.writeConfig', 'success', undefined, {
      verificationState: 'VERIFIED',
      evidenceRefs: [`checkpoint:${index}`],
      observationId: `exp:${index}`,
    });
  }
  model.observe('operator.sandbox.writeConfig', 'success', undefined, {
    verificationState: 'VERIFIED',
    evidenceRefs: ['checkpoint:0'],
    observationId: 'exp:0',
  });
  const assessment = model.get('operator.sandbox.writeConfig')!;
  assert.equal(assessment.attempts, 3);
  assert.equal(assessment.verifiedSuccesses, 3);
  assert.equal(assessment.confidence, 1);
});

test('repeated structured failure creates a useful weakness signal', () => {
  const ledger = new FailureLedger();
  ledger.record(failureExperience('exp_1'), 'PROVIDER_UNAVAILABLE', {
    blocker: 'MISSING_PROVIDER',
    nextPossibleStep: 'Configure RTSP provider.',
  });
  ledger.record(failureExperience('exp_2'), 'PROVIDER_UNAVAILABLE', {
    blocker: 'MISSING_PROVIDER',
    nextPossibleStep: 'Configure RTSP provider.',
  });
  const signal = ledger.weaknessSignals(2)[0]!;
  assert.equal(signal.blocker, 'MISSING_PROVIDER');
  assert.equal(signal.capability, 'cctv.connect');
  assert.match(signal.nextPossibleStep || '', /RTSP/);
});

test('bounded WorkAgent replanning prevents an infinite alternate loop', async () => {
  let invokes = 0;
  const agent = new WorkAgent({
    maxGapReplans: 2,
    invoke: async () => {
      invokes += 1;
      return { ok: false, summary: 'provider unavailable', errorCode: 'PROVIDER_UNAVAILABLE' };
    },
    resolveGap: async (_task, step, _result, attempted, maximum) => gapPlan(step.capability === 'cap.a' ? 'cap.b' : 'cap.a', attempted, maximum),
  });
  const step: PlanStep = {
    id: 'apply_1',
    title: 'Use provider',
    kind: 'apply',
    dependencies: [],
    status: 'pending',
    capability: 'cap.a',
    riskLevel: 'LOW',
    verificationMethod: 'typed',
    retryPolicy: { maxAttempts: 4, attempted: 0 },
  };
  const task = agent.receive('Use a provider', [step]);
  const finished = await agent.run(task.id);
  assert.equal(finished.status, 'BLOCKED');
  assert.equal(finished.goalPursuit?.attempted, 2);
  assert.equal(invokes, 3);
});

test('model identity cannot change runtime capability availability', async () => {
  const host = hostWith(descriptor('system.inspect'), 'up');
  const qwen = new ModelProfileRegistry();
  qwen.register({ id: 'qwen-owner', displayName: 'Qwen owner profile', family: 'qwen', runtime: 'ollama', modalities: ['text'] });
  const llama = new ModelProfileRegistry();
  llama.register({ id: 'llama-test', displayName: 'Llama test profile', family: 'llama', runtime: 'llama.cpp', modalities: ['text'] });
  const certifications = new ModelCertificationRegistry();
  const qwenSnapshot = await buildSelfKnowledgeSnapshot({ host, modelProfiles: qwen, modelCertifications: certifications });
  const llamaSnapshot = await buildSelfKnowledgeSnapshot({ host, modelProfiles: llama, modelCertifications: certifications });
  assert.equal(qwenSnapshot.capabilities[0]?.status, 'AVAILABLE');
  assert.equal(llamaSnapshot.capabilities[0]?.status, 'AVAILABLE');
});

test('CCTV simulation cannot report REAL', async () => {
  const devices = new SimulatedDeviceProvider().list().filter(item => item.kind === 'cctv');
  assert.ok(devices.length > 0);
  assert.ok(devices.every(item => item.simulated));
  const snapshot = await buildSelfKnowledgeSnapshot({ declarations: cctvCapabilityContracts() });
  assert.equal(snapshot.capabilities.some(item => item.id.startsWith('cctv.') && item.status === 'AVAILABLE' && item.implementation.mode === 'REAL'), false);
});

test('CCTV without provider and credentials produces a structured safe gap path', async () => {
  const snapshot = await buildSelfKnowledgeSnapshot({ declarations: cctvCapabilityContracts() });
  const graph = resolveCapabilityGoal(CCTV_CONNECT_GOAL, snapshot);
  const plan = await new CapabilityGapResolver().resolve({ objective: 'Connect to my CCTV', graph, snapshot });
  assert.equal(plan.status, 'NEEDS_OWNER');
  assert.ok(plan.ownerInputRequired.some(item => /credential/i.test(item)));
  assert.ok(plan.possiblePaths.some(item => item.kind === 'RESTORE_OR_CONFIGURE_PROVIDER'));
  assert.ok(plan.possiblePaths.some(item => item.kind === 'REQUEST_OWNER_INPUT'));
  assert.equal(plan.possiblePaths.some(item => item.executableNow), false);
});

test('CCTV credential material is rejected and never stored in the safe profile', () => {
  assert.throws(() => validateCctvConnectionProfile({
    id: 'front', friendlyName: 'Front', providerType: 'RTSP', lanAddress: '192.0.2.10',
    protocol: 'rtsp', capabilityClasses: ['VIEW'], connectionState: 'NOT_CONFIGURED', password: 'secret-value',
  }), /credentialRef/);
  assert.throws(() => validateCctvConnectionProfile({
    id: 'front', friendlyName: 'Front', providerType: 'RTSP', lanAddress: '192.0.2.10',
    protocol: 'rtsp', capabilityClasses: ['VIEW'], connectionState: 'NOT_CONFIGURED', credentialRef: 'plain-password',
  }), /local-secret/);
  assert.throws(() => validateCctvConnectionProfile({
    id: 'front', friendlyName: 'Front', providerType: 'RTSP', lanAddress: 'rtsp://owner:credential@192.0.2.10',
    protocol: 'rtsp', capabilityClasses: ['VIEW'], connectionState: 'NOT_CONFIGURED',
  }), /credentials|secret-like|lanAddress/);
  assert.throws(() => validateCctvConnectionProfile({
    id: 'front', friendlyName: 'Front', providerType: 'RTSP', lanAddress: '192.0.2.10',
    protocol: 'rtsp', streamPath: '/live?token=credential', capabilityClasses: ['VIEW'], connectionState: 'NOT_CONFIGURED',
  }), /secret-like|non-secret allowlist/);
  const safe = validateCctvConnectionProfile({
    id: 'front', friendlyName: 'Front', providerType: 'RTSP', lanAddress: '192.0.2.10',
    protocol: 'rtsp', capabilityClasses: ['VIEW'], connectionState: 'NOT_CONFIGURED', credentialRef: 'local-secret://cctv/front',
  });
  assert.equal(JSON.stringify(safe).includes('password'), false);
});

test('owner-only device metadata remains explicit', () => {
  assert.deepEqual(distributionForCapability('cctv.view'), ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED']);
  assert.ok(new SimulatedDeviceProvider().list().every(item => item.distribution.includes('OWNER_ONLY')));
});

test('cyber owner-only metadata does not remove core security', () => {
  assert.ok(distributionForCapability('cyber.scan').includes('OWNER_ONLY'));
  assert.deepEqual(distributionForCapability('operator.sandbox.writeConfig'), ['CORE']);
  assert.equal(coreSecurityIsDistributionInvariant('operator.sandbox.writeConfig'), true);
});

test('unsafe acquisition still requires owner approval and reviewed runtime registration', () => {
  let candidate = discoverCapabilityCandidate({ id: 'cand_3', capabilityId: 'provider.external', source: 'untrusted repository' });
  while (candidate.state !== 'OWNER_APPROVAL_REQUIRED') candidate = advanceCapabilityCandidate(candidate, `evidence:${candidate.state}`);
  const approved = approveCapabilityCandidate(candidate, 'owner', 'proposal:approved-once');
  assert.throws(() => markCapabilityCandidateRegistered(approved, 'system', 'CapabilityRegistry registration:test-1'), /installation/);
  const installed = markCapabilityCandidateInstalled(approved, 'system', 'sandbox-install:test-1');
  assert.equal(installed.trusted, false, 'installation is not trust');
  assert.equal(installed.executable, false, 'installation is not execution');
  const registered = markCapabilityCandidateRegistered(installed, 'system', 'CapabilityRegistry registration:test-1');
  assert.equal(registered.state, 'REGISTERED');
  assert.equal(registered.executable, false, 'registration is still not execution');
  const enabled = enableCapabilityCandidate(registered, 'owner', 'owner-enable-once:test-1');
  assert.equal(enabled.executable, true);
});

test('Self Knowledge answers are generated from the structured snapshot', async () => {
  const snapshot = await buildSelfKnowledgeSnapshot({ host: hostWith(descriptor('system.inspect'), 'up') });
  const answer = answerFromSelfKnowledge('CAPABILITY_SUMMARY', snapshot);
  assert.match(answer.text, /1 registered capabilities currently report available/);
  assert.deepEqual(answer.capabilityIds, ['system.inspect']);
});

test('Assistant answers what can you do without asking the model to invent capabilities', async () => {
  let modelCalls = 0;
  const host = hostWith(descriptor('system.inspect'), 'up');
  const lab = createJarvisLabRuntime({
    capabilities: host,
    commandCenter: false,
    attachDefaultMemory: false,
    attachDefaultSkills: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    reminders: false,
    research: false,
    workspace: false,
    llm: {
      generateText: async () => {
        modelCalls += 1;
        return 'invented model answer';
      },
    },
  });
  const answer = await lab.ask({ text: 'What can you do?' });
  assert.equal(modelCalls, 0);
  assert.equal(answer.result.answerIntent, 'self_knowledge');
  assert.match(answer.presented.text, /1 registered capabilities currently report available/);
  const control = await lab.ask({ text: 'Can you control my computer?' });
  assert.equal(modelCalls, 0);
  assert.equal(control.result.answerIntent, 'self_knowledge');
  assert.match(control.presented.text, /No structured runtime evidence grants live computer control/);
  const competence = await lab.ask({ text: 'What have you become better at?' });
  assert.equal(modelCalls, 0);
  assert.match(competence.presented.text, /do not yet have enough independently verified outcomes/);
});

function descriptor(id: string, override: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    id,
    description: `Test capability ${id}`,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffect: 'read',
    requiredService: 'test-provider',
    providerKind: 'local',
    timeoutMs: 1_000,
    untrustedOutput: false,
    ...override,
  };
}

function handler(
  value: CapabilityDescriptor,
  availability: 'up' | 'disabled' | 'not_configured' | 'failed' | 'unavailable',
  reason?: string,
): CapabilityHandler {
  return {
    descriptor: () => value,
    availability: async () => ({ id: value.id, availability, degraded: availability !== 'up', ...(reason ? { reason } : {}) }),
    invoke: async () => ({
      capabilityId: value.id,
      status: 'ok',
      structured: { status: 'ok' },
      content: 'ok',
      sourceUrls: [],
      untrustedOutput: value.untrustedOutput,
      sideEffect: value.sideEffect,
    }),
  };
}

function hostWith(
  value: CapabilityDescriptor,
  availability: 'up' | 'disabled' | 'not_configured' | 'failed' | 'unavailable',
  reason?: string,
): CapabilityRegistry {
  const host = new CapabilityRegistry();
  host.register(handler(value, availability, reason));
  return host;
}

function failureExperience(id: string): ExperienceRecord {
  return {
    id,
    createdAt: new Date().toISOString(),
    kind: 'episodic',
    goal: 'Connect CCTV',
    situation: 'No provider',
    actions: ['connect'],
    tools: ['cctv.connect'],
    result: 'provider unavailable',
    outcome: 'failure',
    lessons: [],
    confidence: 0.8,
    privacyClass: 'private',
    domain: 'devices',
  };
}

function gapPlan(capabilityId: string, attempted: number, maximum: number): GapResolutionPlan {
  const path = {
    kind: 'USE_EXISTING_CAPABILITY' as const,
    priority: 1,
    title: `Use ${capabilityId}`,
    capabilityIds: [capabilityId],
    risk: 'LOW' as const,
    ownerInputRequired: [],
    permissionRequired: [],
    externalDependencies: [],
    researchRequired: false,
    executableNow: true,
    inputCompatible: true,
    trustRequired: false,
  };
  return {
    goal: 'Use provider',
    status: 'READY',
    missing: [{ capabilityId: 'missing.provider', blocker: 'MISSING_PROVIDER', currentState: 'NEEDS_PROVIDER', reason: 'missing' }],
    possiblePaths: [path],
    recommendedPath: path,
    ownerInputRequired: [],
    permissionRequired: [],
    verificationStrategy: ['typed result'],
    confidence: 1,
    evidence: ['test:registry'],
    boundedAttempts: { attempted, maximum },
  };
}

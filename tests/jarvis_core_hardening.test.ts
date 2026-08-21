import assert from 'node:assert/strict';
import test from 'node:test';
import { CapabilityRegistry } from '../src/jarvis/capabilities/CapabilityRegistry';
import { createActionGate } from '../src/jarvis/capabilities/actions/ActionGate';
import type { DesktopAllowlists } from '../src/jarvis/capabilities/actions/types';
import type { CapabilityDescriptor, CapabilityResult } from '../src/jarvis/capabilities/types';
import { WorkAgent } from '../src/jarvis/agent/engine';
import type { PlanStep } from '../src/jarvis/agent/types';
import { DestructiveActionCircuitBreaker } from '../src/jarvis/safety/circuitBreaker';
import { rollbackForResult, verificationForResult } from '../src/jarvis/safety/lifecycle';
import { FailureContainment } from '../src/jarvis/safety/failureContainment';
import { PrivilegeLeaseStore } from '../src/jarvis/security/privilegeLease';
import { TrustedOperatorRuntime } from '../src/jarvis/security/trustedOperatorRuntime';
import { ModelCertificationRegistry } from '../src/jarvis/models/ModelCertificationRegistry';
import { ModelProfileRegistry } from '../src/jarvis/models/ModelProfileRegistry';
import { ModelRouter } from '../src/jarvis/models/ModelRouter';
import type { InferenceProvider } from '../src/jarvis/models/InferenceProvider';
import type { InferenceGenerateRequest, ModelProfile } from '../src/jarvis/models/types';

const lists: DesktopAllowlists = {
  applications: [{ id: 'safe-app', displayName: 'Safe app', installed: true, executable: 'safe.exe', allowedArgs: [] }],
  projects: [],
  trustedOrigins: [],
  trustedPathPrefixes: [],
  explorerExecutable: 'explorer.exe',
  workspaceRoot: process.cwd(),
};

test('destructive action classification is typed and unknown destructive scope blocks', () => {
  const breaker = new DestructiveActionCircuitBreaker();
  const descriptor = mutationDescriptor({
    effects: [{
      kind: 'REMOVE_DIRECTORY',
      description: 'Remove a directory.',
      destructive: true,
      reversible: false,
      privilege: 'owner_approval',
      targetInputFields: ['target'],
    }],
  });
  const scoped = breaker.createPreflight({ descriptor, capabilityInput: { target: 'build/cache' }, action: 'Remove cache', why: 'Clear corrupt output' });
  assert.equal(scoped.risk, 'HIGH');
  assert.equal(scoped.reviewRequired, true);
  assert.equal(scoped.blocked, false);
  const unknown = breaker.createPreflight({ descriptor, capabilityInput: {}, action: 'Remove cache', why: 'Clear corrupt output' });
  assert.equal(unknown.risk, 'CRITICAL');
  assert.equal(unknown.blocked, true);
  assert.ok(unknown.reasonCodes.includes('DESTRUCTIVE_SCOPE_UNKNOWN'));
});

test('mass-change circuit breaker uses conservative configurable thresholds', () => {
  const breaker = new DestructiveActionCircuitBreaker({ deleteObjects: 5, moveOrRenameObjects: 20, modifyObjects: 50 });
  const preflight = breaker.createPreflight({
    descriptor: mutationDescriptor({ effects: [{
      kind: 'DELETE',
      description: 'Delete selected files.',
      destructive: true,
      reversible: false,
      privilege: 'owner_approval',
      targets: ['workspace'],
      countInputField: 'paths',
    }] }),
    capabilityInput: { paths: ['1', '2', '3', '4', '5', '6'] },
    action: 'Delete files',
    why: 'Owner cleanup request',
  });
  assert.equal(preflight.reviewRequired, true);
  assert.ok(preflight.reasonCodes.includes('MASS_DELETE_THRESHOLD'));
  assert.equal(preflight.effects[0]?.estimatedAffectedObjects, 6);
});

test('circuit-breaker review upgrades an otherwise allowed action to owner permission', async () => {
  let invoked = 0;
  const registry = new CapabilityRegistry();
  registry.register({
    descriptor: () => mutationDescriptor({
      id: 'desktop.openApplication',
      effects: [{
        kind: 'DELETE',
        description: 'Delete one declared target.',
        destructive: true,
        reversible: false,
        privilege: 'owner_approval',
        targetInputFields: ['applicationId'],
        estimatedAffectedObjects: 1,
      }],
    }),
    availability: async () => ({ id: 'desktop.openApplication', availability: 'up', degraded: false }),
    invoke: async () => {
      invoked += 1;
      return okResult('desktop.openApplication');
    },
  });
  const host = createActionGate(registry, { allowlists: lists });
  const result = await host.invoke({ id: 'desktop.openApplication', input: { applicationId: 'safe-app' }, source: 'system' });
  assert.equal(result.status, 'confirmation_required');
  assert.equal(invoked, 0);
  assert.equal((result.structured.preflight as { reviewRequired?: boolean }).reviewRequired, true);
});

test('structured preflight contains operator fields and redacts secret-like targets', () => {
  const preflight = new DestructiveActionCircuitBreaker().createPreflight({
    descriptor: mutationDescriptor({ effects: [{
      kind: 'CREDENTIAL_CHANGE',
      description: 'Change a credential record.',
      destructive: false,
      reversible: false,
      privilege: 'admin',
      targetInputFields: ['target'],
    }] }),
    capabilityInput: { target: 'api_key=super-secret-value' },
    action: 'Rotate account credential',
    why: 'Owner requested rotation',
    permissionScope: ['credential:one'],
  });
  assert.equal(preflight.action, 'Rotate account credential');
  assert.equal(preflight.why, 'Owner requested rotation');
  assert.equal(preflight.privilegeRequired, 'admin');
  assert.deepEqual(preflight.permissionScope, ['credential:one']);
  assert.doesNotMatch(JSON.stringify(preflight), /super-secret-value/u);
  assert.match(JSON.stringify(preflight), /redacted sensitive target/u);
});

test('privilege leases expose expiry, revocation, and approval provenance without tokens', () => {
  let now = 1_700_000_000_000;
  const store = new PrivilegeLeaseStore({ now: () => now });
  const first = store.issue({
    capabilityIds: ['research.privateBrowse'],
    resourceScopes: ['research'],
    reason: 'Owner approved one private research request.',
    ttlMs: 1_000,
    maxActions: 1,
    taskId: 'task_12345678',
    stepId: 'step_private',
    risk: 'HIGH',
    approvalProvenance: { proposalId: 'proposal_1' },
  }, 'owner');
  assert.equal(first.ok, true);
  assert.equal(store.listInventory()[0]?.state, 'ACTIVE');
  assert.equal('token' in store.listInventory()[0]!, false);
  now += 1_001;
  assert.equal(store.listInventory()[0]?.state, 'EXPIRED');

  const second = store.issue({ capabilityIds: ['research.privateBrowse'], resourceScopes: ['research'], reason: 'Owner approved.', ttlMs: 5_000 }, 'owner');
  assert.equal(second.ok, true);
  if (second.ok) {
    const secretExpansion = store.expand(second.lease.id, 'owner', { resourceScopes: ['token=do-not-store-this'] });
    assert.equal(secretExpansion.ok, false);
    assert.doesNotMatch(JSON.stringify(store.listInventory()), /do-not-store-this/u);
    store.revoke(second.lease.id, 'owner');
  }
  assert.equal(store.listInventory().at(-1)?.state, 'REVOKED');
});

test('lease consumption produces CONSUMED and Emergency Stop suspends new grants', () => {
  const runtime = new TrustedOperatorRuntime();
  const issued = runtime.leases.issue({
    capabilityIds: ['research.privateBrowse'],
    resourceScopes: ['research'],
    reason: 'Owner approved one use.',
    maxActions: 1,
  }, 'owner');
  assert.equal(issued.ok, true);
  assert.equal(runtime.leases.consume('research.privateBrowse', 'research').ok, true);
  assert.equal(runtime.leases.listInventory()[0]?.state, 'CONSUMED');
  runtime.emergency.engage('owner', 'Owner stop test');
  const denied = runtime.leases.issue({ capabilityIds: ['research.privateBrowse'], resourceScopes: ['research'], reason: 'Should not issue.' }, 'owner');
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.reasonCode, 'LEASE_ISSUANCE_SUSPENDED');
});

test('Emergency Stop blocks new execution and cannot be self-cleared', () => {
  const runtime = new TrustedOperatorRuntime();
  runtime.emergency.engage('owner', 'Owner stop test');
  assert.equal(runtime.emergency.allows('system', 'write'), false);
  assert.equal(runtime.emergency.allows('ui', 'read'), true);
  assert.throws(() => runtime.emergency.resume('jarvis', 'self resume'), /Only an explicit owner action/u);
  assert.equal(runtime.emergency.snapshot().active, true);
  runtime.emergency.resume('owner', 'Owner resume test');
  assert.equal(runtime.emergency.snapshot().active, false);
});

test('Emergency Stop reports cancellation semantics for running WorkAgent tasks', async () => {
  const runtime = new TrustedOperatorRuntime();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const agent = new WorkAgent({
    emergency: runtime.emergency,
    invoke: async () => {
      await held;
      return { ok: true, summary: 'late result' };
    },
  });
  const task = agent.receive('Hold one cancellable task', [step('apply_held')]);
  const running = agent.run(task.id);
  await new Promise(resolve => setImmediate(resolve));
  const stopped = runtime.emergency.engage('owner', 'Stop running task');
  assert.equal(stopped.cancellations[0]?.state, 'CANCELLATION_REQUESTED');
  assert.equal(agent.store.get(task.id)?.status, 'CANCELLED');
  assert.throws(() => agent.receive('Blocked new task', [step('apply_new')]), /Emergency Stop is active/u);
  release();
  assert.equal((await running).status, 'CANCELLED');
});

test('verification lifecycle does not equate handler completion with objective success', () => {
  const partialDescriptor = mutationDescriptor({
    verification: { mode: 'handler_result', description: 'Handler result only.' },
  });
  assert.equal(verificationForResult(partialDescriptor, okResult('test.mutate')).state, 'PARTIALLY_VERIFIED');

  const verifiedDescriptor = mutationDescriptor({
    verification: {
      mode: 'structured_postcondition',
      description: 'Expected active state.',
      structuredField: 'active',
      expectedValue: true,
    },
  });
  const verified = verificationForResult(verifiedDescriptor, { ...okResult('test.mutate'), structured: { active: true } });
  assert.equal(verified.state, 'VERIFIED');
  const failed = verificationForResult(verifiedDescriptor, { ...okResult('test.mutate'), structured: { active: false } });
  assert.equal(failed.state, 'FAILED_VERIFICATION');
});

test('rollback is available only when the capability records recovery state', () => {
  const descriptor = mutationDescriptor({
    rollback: { mode: 'recorded_checkpoint', strategy: 'Restore recorded checkpoint.', checkpointField: 'checkpointId' },
  });
  assert.equal(rollbackForResult(descriptor, okResult('test.mutate')).state, 'UNAVAILABLE');
  const recorded = rollbackForResult(descriptor, { ...okResult('test.mutate'), structured: { checkpointId: 'checkpoint_123' } });
  assert.equal(recorded.state, 'AVAILABLE');
  assert.equal(recorded.checkpointId, 'checkpoint_123');
});

test('unexpected destructive effects stop related mutation until owner review', () => {
  const descriptor = mutationDescriptor({ effects: [{
    kind: 'DELETE',
    description: 'Delete one declared file.',
    destructive: true,
    reversible: false,
    privilege: 'owner_approval',
    targetInputFields: ['target'],
  }] });
  const preflight = new DestructiveActionCircuitBreaker().createPreflight({
    descriptor,
    capabilityInput: { target: 'workspace/cache.bin' },
    action: 'Delete corrupt cache',
    why: 'Owner requested cleanup',
  });
  const containment = new FailureContainment();
  const incident = containment.observe({
    capabilityId: descriptor.id,
    preflight,
    result: {
      ...okResult(descriptor.id),
      status: 'error',
      error: 'Delete failed after mutation began.',
      structured: { affectedTargets: ['workspace/cache.bin'] },
    },
    recovery: { state: 'UNAVAILABLE', strategy: 'No recovery checkpoint was recorded.' },
  });
  assert.equal(incident?.reasonCode, 'DESTRUCTIVE_EXECUTION_FAILED');
  assert.equal(containment.blocks(descriptor.id, preflight)?.id, incident?.id);
  assert.equal(containment.clear(incident!.id, 'jarvis'), false);
  assert.equal(containment.blocks(descriptor.id, preflight)?.active, true);
  assert.equal(containment.clear(incident!.id, 'owner'), true);
  assert.equal(containment.blocks(descriptor.id, preflight), undefined);
});

test('model profiles accept non-Qwen and unknown families without invented metadata', () => {
  const profiles = new ModelProfileRegistry();
  profiles.register({ id: 'generic-model', displayName: 'Generic Local Model', runtime: 'lm-studio', modalities: ['text'] });
  const stored = profiles.get('generic-model');
  assert.equal(stored?.displayName, 'Generic Local Model');
  assert.equal(stored?.family, undefined);
  assert.equal(stored?.parameterCount, undefined);
});

test('model router rejects no-tool, UNKNOWN, and FAIL certification behavior', async () => {
  const profiles = new ModelProfileRegistry();
  const certifications = new ModelCertificationRegistry();
  const noTools: ModelProfile = {
    id: 'no-tools',
    displayName: 'No Tools Model',
    runtime: 'unknown',
    modalities: ['text'],
    toolUse: false,
  };
  profiles.register(noTools);
  certifications.record({ modelId: noTools.id, capability: 'TOOL_SELECTION', state: 'PASS', evidence: ['benchmark:tool-selection-1'] });
  const noToolRouter = new ModelRouter(profiles, certifications, [fakeProvider(noTools)]);
  assert.equal(await noToolRouter.route({ requiredCapabilities: ['TOOL_SELECTION'] }), undefined);

  const unknown: ModelProfile = { id: 'unknown-cert', displayName: 'Unknown Certification', runtime: 'unknown', modalities: ['text'] };
  profiles.register(unknown);
  certifications.record({ modelId: unknown.id, capability: 'CONVERSATION', state: 'UNKNOWN', evidence: [] });
  const unknownRouter = new ModelRouter(profiles, certifications, [fakeProvider(unknown)]);
  assert.equal(await unknownRouter.route({ requiredCapabilities: ['CONVERSATION'] }), undefined);
  certifications.record({ modelId: unknown.id, capability: 'CONVERSATION', state: 'FAIL', evidence: ['benchmark:conversation-failed'] });
  assert.equal(await unknownRouter.route({ requiredCapabilities: ['CONVERSATION'] }), undefined);
  certifications.record({ modelId: unknown.id, capability: 'CONVERSATION', state: 'PASS', evidence: ['benchmark:conversation-passed'] });
  assert.equal((await unknownRouter.route({ requiredCapabilities: ['CONVERSATION'] }))?.modelId, unknown.id);

  const provider = fakeProvider(unknown, 'local-runtime');
  const providerAgnosticRouter = new ModelRouter(profiles, certifications, [provider]);
  assert.equal((await providerAgnosticRouter.route({
    requiredCapabilities: ['CONVERSATION'],
    preferredModelId: unknown.id,
  }))?.provider.id, 'local-runtime');
});

function mutationDescriptor(overrides: Partial<CapabilityDescriptor> = {}): CapabilityDescriptor {
  return {
    id: 'test.mutate',
    description: 'Mutate one typed test target.',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffect: 'write',
    requiredService: 'test',
    providerKind: 'local',
    timeoutMs: 1_000,
    untrustedOutput: false,
    ...overrides,
  };
}

function okResult(capabilityId: string): CapabilityResult {
  return {
    capabilityId,
    status: 'ok',
    structured: { status: 'completed' },
    content: 'completed',
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
  };
}

function step(id: string): PlanStep {
  return {
    id,
    title: 'Held mutation',
    kind: 'apply',
    dependencies: [],
    status: 'pending',
    riskLevel: 'MEDIUM',
    verificationMethod: 'postcondition',
    retryPolicy: { maxAttempts: 1, attempted: 0 },
  };
}

function fakeProvider(profile: ModelProfile, providerId = profile.id): InferenceProvider {
  return {
    id: providerId,
    health: async () => ({ providerId, available: true, modelAvailable: true }),
    generate: async (_request: InferenceGenerateRequest) => ({ text: 'ok' }),
    stream: async function* () { yield 'ok'; },
    modelInfo: async () => profile,
    metrics: () => ({}),
  };
}

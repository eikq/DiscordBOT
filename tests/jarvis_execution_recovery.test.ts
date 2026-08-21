import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WorkAgent } from '../src/jarvis/agent/engine';
import { createCapabilityWorkInvoker } from '../src/jarvis/agent/capabilityInvoker';
import type { PlanStep } from '../src/jarvis/agent/types';
import { CapabilityRegistry } from '../src/jarvis/capabilities/CapabilityRegistry';
import { cancelledCapabilityResult, createAbortReason, readAbortReason } from '../src/jarvis/capabilities/cancellation';
import { isActionHost, type ActionHost } from '../src/jarvis/capabilities/actions/ActionGate';
import { createStandaloneCapabilityHost } from '../src/jarvis/capabilities/standaloneHost';
import type { CapabilityDescriptor, CapabilityHandler, CapabilityResult } from '../src/jarvis/capabilities/types';
import { RecoveryCheckpointStore } from '../src/jarvis/recovery/checkpointStore';
import {
  RECOVERY_SANDBOX_MUTATE,
  RECOVERY_SANDBOX_ROLLBACK,
  RECOVERY_SANDBOX_TARGET,
  registerRecoverySandboxCapabilities,
} from '../src/jarvis/recovery/sandboxCapability';
import { FailureContainment } from '../src/jarvis/safety/failureContainment';
import { DestructiveActionCircuitBreaker } from '../src/jarvis/safety/circuitBreaker';
import { VerificationRegistry } from '../src/jarvis/safety/verificationRegistry';
import { TrustedOperatorRuntime } from '../src/jarvis/security/trustedOperatorRuntime';

test('AbortSignal reaches a cancellable typed handler and owner cancellation is acknowledged', async () => {
  const registry = new CapabilityRegistry();
  let observedReason: string | undefined;
  registry.register(cooperativeHandler('test.cancellable', async signal => {
    await abortObserved(signal);
    observedReason = readAbortReason(signal)?.reason;
    return cancelledCapabilityResult({ capabilityId: 'test.cancellable', sideEffect: 'read', untrustedOutput: false, signal });
  }));
  const controller = new AbortController();
  const running = registry.invoke({ id: 'test.cancellable', input: {}, signal: controller.signal });
  controller.abort(createAbortReason('OWNER_CANCEL'));
  const result = await running;
  assert.equal(observedReason, 'OWNER_CANCEL');
  assert.equal(result.status, 'cancelled');
  assert.equal((result.structured.cancellation as { state: string }).state, 'CANCELLED');
  assert.equal((result.structured.cancellation as { observedByHandler: boolean }).observedByHandler, true);
});

test('WorkAgent cancellation remains requested until the typed handler acknowledges it', async () => {
  const registry = new CapabilityRegistry();
  registry.register(cooperativeHandler('test.agent-cancellable', async signal => {
    await abortObserved(signal);
    return cancelledCapabilityResult({ capabilityId: 'test.agent-cancellable', sideEffect: 'read', untrustedOutput: false, signal });
  }));
  const agent = new WorkAgent({ invoke: createCapabilityWorkInvoker({ host: registry }) });
  const task = agent.receive('Cancel typed action', [applyStep('test.agent-cancellable')]);
  const running = agent.run(task.id);
  await new Promise(resolve => setImmediate(resolve));
  const requested = agent.cancel(task.id);
  assert.equal(requested.status, 'EXECUTING');
  assert.equal(requested.cancellation?.state, 'CANCELLATION_REQUESTED');
  const cancelled = await running;
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.cancellation?.state, 'CANCELLED');
  assert.equal(cancelled.cancellation?.observedByHandler, true);
});

test('Emergency Stop reaches a running handler and blocks new WorkAgent execution', async () => {
  const root = tempRoot();
  try {
    const runtime = new TrustedOperatorRuntime({ runtimeRoot: root });
    const registry = new CapabilityRegistry();
    let reason: string | undefined;
    registry.register(cooperativeHandler('test.emergency-cancellable', async signal => {
      await abortObserved(signal);
      reason = readAbortReason(signal)?.reason;
      return cancelledCapabilityResult({ capabilityId: 'test.emergency-cancellable', sideEffect: 'read', untrustedOutput: false, signal });
    }));
    const agent = new WorkAgent({ emergency: runtime.emergency, invoke: createCapabilityWorkInvoker({ host: registry }) });
    const task = agent.receive('Emergency cancellation', [applyStep('test.emergency-cancellable')]);
    const running = agent.run(task.id);
    await new Promise(resolve => setImmediate(resolve));
    const snapshot = runtime.emergency.engage('owner', 'Test running cancellation');
    assert.ok(snapshot.cancellations.some(item => item.state === 'CANCELLATION_REQUESTED'));
    assert.throws(() => agent.receive('Blocked task'), /Emergency Stop is active/u);
    const done = await running;
    assert.equal(reason, 'EMERGENCY_STOP');
    assert.equal(done.cancellation?.state, 'CANCELLED');
    assert.ok(runtime.emergency.snapshot().cancellations.some(item => item.workId === task.id && item.state === 'CANCELLED'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('running non-cancellable handler reports completion after cancellation honestly', async () => {
  const registry = new CapabilityRegistry();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  registry.register({
    descriptor: () => readDescriptor('test.non-cancellable'),
    availability: async () => ({ id: 'test.non-cancellable', availability: 'up', degraded: false }),
    invoke: async () => {
      await held;
      return okResult('test.non-cancellable');
    },
  });
  const agent = new WorkAgent({ invoke: createCapabilityWorkInvoker({ host: registry }) });
  const task = agent.receive('Do not overclaim cancellation', [applyStep('test.non-cancellable')]);
  const running = agent.run(task.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(agent.cancel(task.id).cancellation?.state, 'CANCELLATION_REQUESTED');
  release();
  const done = await running;
  assert.equal(done.status, 'CANCELLED');
  assert.equal(done.cancellation?.state, 'COMPLETED_BEFORE_CANCEL');
  assert.equal(done.cancellation?.observedByHandler, false);
});

test('timeout is distinct from owner cancellation and does not claim handler acknowledgement', async () => {
  const registry = new CapabilityRegistry();
  registry.register(cooperativeHandler('test.timeout', async () => new Promise<CapabilityResult>(() => undefined), 15));
  const result = await registry.invoke({ id: 'test.timeout', input: {}, timeoutMs: 15 });
  const cancellation = result.structured.cancellation as { reason: string; state: string; observedByHandler: boolean };
  assert.equal(result.status, 'timeout');
  assert.equal(cancellation.reason, 'TIMEOUT');
  assert.equal(cancellation.state, 'CANCELLATION_REQUESTED');
  assert.equal(cancellation.observedByHandler, false);
});

test('checkpoint-backed mutation verifies, survives restart, is idempotent, and rolls back twice safely', async () => {
  const root = tempRoot();
  try {
    const firstHost = recoveryHost(root);
    const operation = { operationId: 'operation_0001', value: 'calm-blue' };
    const first = await confirmed(firstHost, RECOVERY_SANDBOX_MUTATE, operation, 'mutation-1');
    assert.equal(first.status, 'ok');
    assert.equal((first.structured.verification as { state: string }).state, 'VERIFIED');
    assert.equal((first.structured.rollback as { state: string }).state, 'AVAILABLE');
    assert.equal((first.structured.preflight as { affectedTargets: string[] }).affectedTargets[0], RECOVERY_SANDBOX_TARGET);
    const checkpointId = String(first.structured.checkpointId);
    assert.match(checkpointId, /^checkpoint_/u);
    const checkpoints = new RecoveryCheckpointStore(path.join(root, 'recovery', 'checkpoints')).list();
    assert.equal(checkpoints.find(item => item.checkpointId === checkpointId)?.state, 'AVAILABLE');

    const restartedHost = recoveryHost(root);
    const duplicate = await confirmed(restartedHost, RECOVERY_SANDBOX_MUTATE, operation, 'mutation-2');
    assert.equal(duplicate.status, 'ok');
    assert.equal(duplicate.structured.checkpointId, checkpointId);
    assert.equal(duplicate.structured.idempotent, true);

    const rollback = await confirmed(restartedHost, RECOVERY_SANDBOX_ROLLBACK, {
      checkpointId,
      rollbackId: 'rollback_0001',
    }, 'rollback-1');
    assert.equal(rollback.status, 'ok');
    assert.equal(rollback.structured.rollbackVerification, 'ROLLBACK_VERIFIED');
    assert.equal((rollback.structured.verification as { state: string }).state, 'VERIFIED');
    assert.equal(fs.existsSync(path.join(root, 'sandbox', 'config.json')), false);

    const duplicateRollback = await confirmed(restartedHost, RECOVERY_SANDBOX_ROLLBACK, {
      checkpointId,
      rollbackId: 'rollback_0002',
    }, 'rollback-2');
    assert.equal(duplicateRollback.status, 'ok');
    assert.equal(duplicateRollback.structured.idempotent, true);
    assert.equal(duplicateRollback.structured.rollbackVerification, 'ROLLBACK_VERIFIED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cancellation during sandbox mutation stops before commit and retains a real checkpoint', async () => {
  const root = tempRoot();
  try {
    const checkpoints = new RecoveryCheckpointStore(path.join(root, 'recovery', 'checkpoints'));
    const verification = new VerificationRegistry();
    const registry = new CapabilityRegistry();
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    registerRecoverySandboxCapabilities(registry, {
      root,
      checkpoints,
      verification,
      beforeCommit: async signal => {
        entered();
        await abortObserved(signal);
      },
    });
    const controller = new AbortController();
    const running = registry.invoke({
      id: RECOVERY_SANDBOX_MUTATE,
      input: { operationId: 'operation_0002', value: 'cancel-before-commit' },
      signal: controller.signal,
    });
    await started;
    controller.abort(createAbortReason('OWNER_CANCEL'));
    const result = await running;
    assert.equal(result.status, 'cancelled');
    assert.equal((result.structured.cancellation as { state: string }).state, 'CANCELLED');
    assert.equal(fs.existsSync(path.join(root, 'sandbox', 'config.json')), false);
    assert.equal(checkpoints.list()[0]?.state, 'AVAILABLE');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mutation timeout cannot be retried silently and persistent containment fails closed across restart', () => {
  const root = tempRoot();
  try {
    const persistPath = path.join(root, 'containment.json');
    const containment = new FailureContainment(undefined, () => Date.now(), persistPath);
    const descriptor: CapabilityDescriptor = {
      ...readDescriptor('test.mutation-timeout'),
      sideEffect: 'write',
      effects: [{
        kind: 'MODIFY',
        description: 'Bounded test mutation.',
        destructive: false,
        reversible: true,
        privilege: 'owner_approval',
        targets: ['jarvis-owned:test'],
      }],
    };
    const preflight = new DestructiveActionCircuitBreaker().createPreflight({
      descriptor,
      capabilityInput: {},
      action: 'Bounded test mutation',
      why: 'Containment persistence test',
    });
    const incident = containment.observe({
      capabilityId: descriptor.id,
      preflight,
      result: {
        ...okResult(descriptor.id),
        status: 'timeout',
        sideEffect: 'write',
        structured: {
          cancellation: {
            support: 'cooperative',
            state: 'CANCELLATION_REQUESTED',
            reason: 'TIMEOUT',
            observedByHandler: false,
            detail: 'Unknown partial effect.',
          },
          affectedTargets: ['jarvis-owned:test'],
        },
      },
      recovery: { state: 'AVAILABLE', strategy: 'Recorded test checkpoint.', checkpointId: 'checkpoint_test' },
    });
    assert.equal(incident?.reasonCode, 'MUTATION_OUTCOME_UNKNOWN');
    const restarted = new FailureContainment(undefined, () => Date.now(), persistPath);
    assert.equal(restarted.blocks(descriptor.id, preflight)?.active, true);
    assert.equal(restarted.clear(incident!.id, 'jarvis'), false);
    assert.equal(restarted.clear(incident!.id, 'owner'), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recovery metadata rejects secrets and runtime policy is model-independent', async () => {
  const root = tempRoot();
  try {
    const checkpoints = new RecoveryCheckpointStore(path.join(root, 'checkpoints'));
    assert.throws(() => checkpoints.create({
      capabilityId: RECOVERY_SANDBOX_MUTATE,
      scope: [RECOVERY_SANDBOX_TARGET],
      affectedTargets: [RECOVERY_SANDBOX_TARGET],
      priorState: { authorization: 'Bearer abcdefghijklmnop' },
    }), /secret-like material/u);

    const host = recoveryHost(root);
    const rejected = await host.invoke({
      id: RECOVERY_SANDBOX_MUTATE,
      input: { operationId: 'operation_0003', value: 'API_KEY=abcdefghijklmnop' },
      source: 'ui',
    });
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.structured.reasonCode, 'SECRET_INPUT_REJECTED');
    assert.equal(JSON.stringify(rejected).includes('abcdefghijklmnop'), false);

    const proposal = await host.invoke({
      id: RECOVERY_SANDBOX_MUTATE,
      input: { operationId: 'operation_0004', value: 'provider-neutral' },
      source: 'ui',
    });
    assert.equal(proposal.status, 'confirmation_required');
    assert.equal(JSON.stringify(proposal.structured.preflight).toLowerCase().includes('qwen'), false);
    assert.equal(JSON.stringify(proposal.structured.preflight).toLowerCase().includes('ollama'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function recoveryHost(root: string): ActionHost {
  const host = createStandaloneCapabilityHost({
    worldIntel: false,
    reminders: false,
    research: false,
    workspace: false,
    actions: { audit: false, recoveryRoot: root },
  });
  assert.equal(isActionHost(host), true);
  return host as ActionHost;
}

async function confirmed(
  host: ActionHost,
  id: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<CapabilityResult> {
  const proposed = await host.invoke({ id, input, source: 'ui', requestId });
  assert.equal(proposed.status, 'confirmation_required');
  return host.confirm({
    proposalId: String(proposed.structured.proposalId),
    token: String(proposed.structured.confirmToken),
    source: 'ui',
    requestId,
  });
}

function cooperativeHandler(
  id: string,
  invoke: (signal: AbortSignal) => Promise<CapabilityResult>,
  timeoutMs = 5_000,
): CapabilityHandler {
  return {
    descriptor: () => ({ ...readDescriptor(id), timeoutMs, cancellation: { support: 'cooperative' } }),
    availability: async () => ({ id, availability: 'up', degraded: false }),
    invoke: async (_input, context) => invoke(context?.signal ?? new AbortController().signal),
  };
}

function readDescriptor(id: string): CapabilityDescriptor {
  return {
    id,
    description: id,
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffect: 'read',
    requiredService: 'test',
    providerKind: 'local',
    timeoutMs: 5_000,
    untrustedOutput: false,
  };
}

function okResult(id: string): CapabilityResult {
  return {
    capabilityId: id,
    status: 'ok',
    structured: { status: 'ok' },
    content: 'ok',
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'read',
  };
}

function applyStep(capability: string): PlanStep {
  return {
    id: `step_${capability.replace(/[^a-z0-9]/giu, '_')}`,
    title: capability,
    kind: 'apply',
    dependencies: [],
    status: 'pending',
    capability,
    input: {},
    riskLevel: 'LOW',
    verificationMethod: 'typed result',
    retryPolicy: { maxAttempts: 1, attempted: 0 },
  };
}

function abortObserved(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-recovery-test-'));
}

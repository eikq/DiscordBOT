import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { isActionHost, type ActionHost } from '../src/jarvis/capabilities/actions/ActionGate';
import { createStandaloneCapabilityHost } from '../src/jarvis/capabilities/standaloneHost';
import {
  ExecutionJournalCoordinator,
  fingerprintAction,
  JOURNAL_SCHEMA_VERSION,
} from '../src/jarvis/executionJournal';
import { RecoveryCheckpointStore } from '../src/jarvis/recovery/checkpointStore';
import {
  RECOVERY_SANDBOX_MUTATE,
  RECOVERY_SANDBOX_ROLLBACK,
  RECOVERY_SANDBOX_TARGET,
} from '../src/jarvis/recovery/sandboxCapability';
import { FailureContainment } from '../src/jarvis/safety/failureContainment';

test('valid journal transitions persist and invalid transitions fail closed', () => {
  const journal = memoryJournal();
  const record = authorize(journal, {
    operationId: 'operation_trans1',
    capabilityId: RECOVERY_SANDBOX_MUTATE,
    action: { operationId: 'operation_trans1', value: 'one' },
    scope: [RECOVERY_SANDBOX_TARGET],
  });
  assert.equal(record.executionState, 'AUTHORIZED');
  assert.throws(
    () => journal.transition(record.operationId, 'COMPLETED', 'system'),
    /Impossible journal transition/u,
  );
});

test('journal persists across restart and discovers active operations', () => {
  const root = tempRoot();
  try {
    const first = fileJournal(root);
    const created = authorize(first, {
      operationId: 'operation_persist',
      capabilityId: RECOVERY_SANDBOX_MUTATE,
      action: { operationId: 'operation_persist', value: 'keep' },
      scope: [RECOVERY_SANDBOX_TARGET],
    });
    const restarted = fileJournal(root);
    assert.equal(restarted.get(created.operationId)?.executionState, 'AUTHORIZED');
    assert.equal(restarted.discoverActive().some(item => item.operationId === created.operationId), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CHECKPOINTED restart does not auto-mutate while prior state remains', () => {
  const root = tempRoot();
  try {
    const journal = fileJournal(root);
    const operationId = 'operation_cp1';
    authorize(journal, sandboxPropose(operationId, 'prior-stay'));
    const checkpoint = journal.checkpoints!.create({
      capabilityId: RECOVERY_SANDBOX_MUTATE,
      scope: [RECOVERY_SANDBOX_TARGET],
      affectedTargets: [RECOVERY_SANDBOX_TARGET],
      priorState: { exists: false, digest: 'abc' },
    });
    journal.recordCheckpoint(operationId, checkpoint.checkpointId);
    const restarted = fileJournal(root);
    const reconciled = restarted.reconcile(operationId, { observed: 'PRIOR', evidenceRef: 'digest-prior' });
    assert.equal(reconciled.executionState, 'CHECKPOINTED');
    assert.equal(reconciled.recoveryDisposition, 'RETRY_OFFERED');
    assert.equal(restarted.mutationGate(operationId).allowed, false);
    assert.equal(restarted.mutationGate(operationId).reasonCode, 'CHECKPOINT_RETRY_NOT_AUTHORIZED');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('EXECUTING unknown commit becomes AMBIGUOUS and containment', () => {
  const root = tempRoot();
  try {
    const journal = fileJournal(root);
    const operationId = 'operation_exec1';
    authorize(journal, sandboxPropose(operationId, 'unknown-commit'));
    bindCheckpoint(journal, root, operationId);
    journal.transition(operationId, 'EXECUTING', 'system');
    const restarted = fileJournal(root);
    const contained = restarted.reconcile(operationId, { observed: 'UNKNOWN', evidenceRef: 'crash-window' });
    assert.equal(contained.executionState, 'CONTAINED');
    assert.equal(contained.recoveryDisposition, 'CONTAINED');
    assert.ok(restarted.store.get(operationId)?.containmentIncidentId);
    assert.equal(restarted.mutationGate(operationId).allowed, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MUTATED resumes verification only and verification retry does not remutate', () => {
  const journal = memoryJournal();
  const operationId = 'operation_mut1';
  authorize(journal, sandboxPropose(operationId, 'verify-only'));
  bindMemoryCheckpoint(journal, operationId);
  journal.transition(operationId, 'EXECUTING', 'system');
  journal.transition(operationId, 'MUTATED', 'system');
  const verifying = journal.reconcile(operationId, { observed: 'INTENDED', evidenceRef: 'digest-intended' });
  assert.equal(verifying.executionState, 'VERIFYING');
  assert.equal(verifying.recoveryDisposition, 'VERIFY_ONLY');
  const gate = journal.mutationGate(operationId);
  assert.equal(gate.allowed, false);
  assert.equal(gate.verifyOnly, true);
  const verified = journal.recordVerification(operationId, 'VERIFIED');
  assert.equal(verified.executionState, 'VERIFIED');
  assert.equal(journal.mutationGate(operationId).verifyOnly, true);
});

test('neither prior nor intended state contains the operation', () => {
  const journal = memoryJournal();
  const operationId = 'operation_neither';
  authorize(journal, sandboxPropose(operationId, 'drift'));
  bindMemoryCheckpoint(journal, operationId);
  journal.transition(operationId, 'EXECUTING', 'system');
  journal.transition(operationId, 'MUTATED', 'system');
  const contained = journal.reconcile(operationId, { observed: 'NEITHER', evidenceRef: 'foreign-state' });
  assert.equal(contained.executionState, 'CONTAINED');
});

test('rollback reconciliation verifies restored state and does not blindly rollback again', () => {
  const journal = memoryJournal();
  const parentId = 'operation_rb_parent';
  authorize(journal, sandboxPropose(parentId, 'to-rollback'));
  const checkpointId = bindMemoryCheckpoint(journal, parentId);
  journal.transition(parentId, 'EXECUTING', 'system');
  journal.transition(parentId, 'MUTATED', 'system');
  journal.transition(parentId, 'VERIFYING', 'system');
  journal.recordVerification(parentId, 'VERIFIED');
  const rollback = journal.beginRollback(parentId, checkpointId, 'rollback_0001', 'system', RECOVERY_SANDBOX_ROLLBACK);
  assert.equal(rollback.kind, 'ROLLBACK');
  assert.equal(rollback.parentOperationId, parentId);
  journal.transition(rollback.operationId, 'AUTHORIZED', 'system');
  journal.transition(rollback.operationId, 'ROLLBACK_PENDING', 'system');
  journal.transition(rollback.operationId, 'ROLLING_BACK', 'system');
  const reconciled = journal.reconcile(rollback.operationId, { observed: 'PRIOR', evidenceRef: 'restored' });
  assert.equal(reconciled.executionState, 'ROLLING_BACK');
  assert.equal(reconciled.recoveryDisposition, 'VERIFY_ONLY');
  const rolled = journal.recordVerification(rollback.operationId, 'VERIFIED');
  assert.equal(rolled.executionState, 'ROLLED_BACK');
  assert.equal(journal.mutationGate(rollback.operationId).allowed, false);
});

test('corrupt active journal fails closed', () => {
  const root = tempRoot();
  try {
    const dbPath = path.join(root, 'execution-journal.db');
    const first = fileJournal(root);
    authorize(first, sandboxPropose('operation_corrupt', 'x'));
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE execution_journal SET payload = ?, execution_state = ? WHERE operation_id = ?').run(
      JSON.stringify({ operationId: 'operation_corrupt', executionState: 'EXECUTING' }),
      'EXECUTING',
      'operation_corrupt',
    );
    db.close();
    const restarted = fileJournal(root);
    assert.equal(restarted.failClosed(), true);
    assert.throws(() => restarted.propose(sandboxPropose('operation_after_corrupt', 'y')), /fail-closed|schema validation/u);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('action fingerprints are deterministic and change when the action changes', () => {
  const left = fingerprintAction(RECOVERY_SANDBOX_MUTATE, { operationId: 'operation_fp', value: 'same' });
  const right = fingerprintAction(RECOVERY_SANDBOX_MUTATE, { value: 'same', operationId: 'operation_fp' });
  const changed = fingerprintAction(RECOVERY_SANDBOX_MUTATE, { operationId: 'operation_fp', value: 'other' });
  assert.equal(left, right);
  assert.notEqual(left, changed);
});

test('secret material cannot be journaled and journal cannot grant permission or revive leases', () => {
  const journal = memoryJournal();
  assert.throws(
    () => journal.propose({
      ...sandboxPropose('operation_secret', 'API_KEY=abcdefghijklmnop'),
    }),
    /secret-like material|must not persist/u,
  );
  assert.throws(() => journal.grantPermission(), /cannot grant permission/u);
  assert.throws(() => journal.reviveLease(), /cannot revive/u);
});

test('Emergency Stop records interruption and resume does not auto-resume mutation', () => {
  const journal = memoryJournal();
  const operationId = 'operation_stop1';
  authorize(journal, sandboxPropose(operationId, 'stop'));
  bindMemoryCheckpoint(journal, operationId);
  const stopped = journal.markEmergencyStop(operationId, 'system');
  assert.equal(stopped.executionState, 'CANCELLATION_REQUESTED');
  assert.equal(stopped.recoveryDisposition, 'EMERGENCY_STOP');
  assert.throws(() => journal.noteEmergencyResume('model'), /does not auto-resume/u);
  journal.noteEmergencyResume('owner');
  assert.equal(journal.get(operationId)?.executionState, 'CANCELLATION_REQUESTED');
  assert.equal(journal.mutationGate(operationId).allowed, false);
});

test('pending-goal and reminder journal identities cannot duplicate mutation', () => {
  const journal = memoryJournal();
  const input = {
    operationId: 'operation_remind1',
    capabilityId: 'reminders.create',
    action: { title: 'Test Jarvis', whenText: 'Tomorrow at 15:00' },
    scope: ['reminders'],
    idempotencyClass: 'IDEMPOTENT' as const,
    idempotencyKey: 'Test Jarvis|Tomorrow at 15:00|',
  };
  const first = journal.propose(input);
  journal.transition(first.operationId, 'PREFLIGHTED', 'system');
  journal.transition(first.operationId, 'WAITING_PERMISSION', 'system');
  journal.transition(first.operationId, 'AUTHORIZED', 'system');
  const duplicate = journal.propose(input);
  assert.equal(duplicate.operationId, first.operationId);
  assert.throws(
    () => journal.propose({
      ...input,
      action: { title: 'Test Jarvis', whenText: 'Tomorrow at 16:00' },
    }),
    /different action or scope/u,
  );
});

test('IDEMPOTENT operations deduplicate while UNKNOWN and NON_IDEMPOTENT never auto-replay', () => {
  const journal = memoryJournal();
  const idempotent = authorize(journal, {
    ...sandboxPropose('operation_idem1', 'same'),
    idempotencyClass: 'IDEMPOTENT',
    idempotencyKey: 'operation_idem1',
  });
  assert.equal(journal.propose({
    ...sandboxPropose('operation_idem1', 'same'),
    idempotencyClass: 'IDEMPOTENT',
    idempotencyKey: 'operation_idem1',
  }).operationId, idempotent.operationId);

  const unknown = authorize(journal, {
    ...sandboxPropose('operation_unk1', 'x'),
    idempotencyClass: 'UNKNOWN',
  });
  bindMemoryCheckpoint(journal, unknown.operationId);
  assert.equal(journal.mutationGate(unknown.operationId).allowed, true);
  const restored = new ExecutionJournalCoordinator({
    checkpoints: journal.checkpoints,
    containment: new FailureContainment(),
  });
  restored.store.put(journal.get(unknown.operationId)!);
  assert.equal(restored.mutationGate(unknown.operationId).reasonCode, 'CHECKPOINT_RETRY_NOT_AUTHORIZED');
  restored.authorizeRetry(unknown.operationId, 'owner');
  assert.equal(restored.mutationGate(unknown.operationId).reasonCode, 'UNKNOWN_IDEMPOTENCY_NO_REPLAY');

  const nonIdempotent = authorize(journal, {
    ...sandboxPropose('operation_non1', 'once'),
    idempotencyClass: 'NON_IDEMPOTENT',
  });
  bindMemoryCheckpoint(journal, nonIdempotent.operationId);
  const nonReplay = new ExecutionJournalCoordinator({
    checkpoints: journal.checkpoints,
    containment: new FailureContainment(),
  });
  nonReplay.store.put(journal.get(nonIdempotent.operationId)!);
  nonReplay.authorizeRetry(nonIdempotent.operationId, 'owner');
  assert.equal(nonReplay.mutationGate(nonIdempotent.operationId).reasonCode, 'NON_IDEMPOTENT_NO_REPLAY');
});

test('checkpoint must exist, scope must match, and consumed checkpoints cannot authorize another mutation', () => {
  const journal = memoryJournal();
  const operationId = 'operation_cpscope';
  authorize(journal, sandboxPropose(operationId, 'scope'));
  assert.throws(() => journal.recordCheckpoint(operationId, 'checkpoint_11111111-1111-1111-1111-111111111111'), /existing recovery checkpoint/u);
  const mismatched = journal.checkpoints!.create({
    capabilityId: RECOVERY_SANDBOX_MUTATE,
    scope: ['jarvis-owned:other-sandbox/config.json'],
    affectedTargets: ['jarvis-owned:other-sandbox/config.json'],
    priorState: { exists: false, digest: 'other' },
  });
  assert.throws(() => journal.recordCheckpoint(operationId, mismatched.checkpointId), /scope does not match/u);
  const consumedId = bindMemoryCheckpoint(journal, operationId);
  const second = authorize(journal, sandboxPropose('operation_cpscope2', 'other'));
  journal.checkpoints!.markConsumed(consumedId, 'ROLLBACK_VERIFIED');
  assert.throws(() => journal.recordCheckpoint(second.operationId, consumedId), /consumed or invalid checkpoint/u);
});

test('model identity cannot set journal state', () => {
  const journal = memoryJournal();
  const record = journal.propose(sandboxPropose('operation_model', 'nope'));
  assert.throws(
    () => journal.transition(record.operationId, 'PREFLIGHTED', 'model'),
    /Model identity cannot set/u,
  );
});

test('rollback is a separate operation and step verification is not entire goal success', () => {
  const journal = memoryJournal();
  const parentId = 'operation_goalstep';
  const proposed = journal.propose({
    ...sandboxPropose(parentId, 'step'),
    goalId: 'goal.remind',
    taskId: 'task_1',
    stepId: 'step_1',
  });
  journal.transition(parentId, 'PREFLIGHTED', 'system');
  journal.transition(parentId, 'WAITING_PERMISSION', 'system');
  journal.transition(parentId, 'AUTHORIZED', 'system');
  bindMemoryCheckpoint(journal, parentId);
  journal.transition(parentId, 'EXECUTING', 'system');
  journal.transition(parentId, 'MUTATED', 'system');
  journal.transition(parentId, 'VERIFYING', 'system');
  const verified = journal.recordVerification(parentId, 'VERIFIED');
  assert.equal(verified.executionState, 'VERIFIED');
  assert.equal(verified.recoveryDisposition, 'STEP_VERIFIED_GOAL_OPEN');
  assert.notEqual(verified.executionState, 'COMPLETED');
  const checkpointId = verified.checkpointId!;
  const rollback = journal.beginRollback(parentId, checkpointId, 'rollback_goal', 'system', RECOVERY_SANDBOX_ROLLBACK);
  assert.notEqual(rollback.operationId, parentId);
  assert.equal(rollback.kind, 'ROLLBACK');
});

test('invalid persisted schema, duplicate identity, and invalid rollback checkpoint are rejected', () => {
  const root = tempRoot();
  try {
    const dbPath = path.join(root, 'execution-journal.db');
    fs.mkdirSync(root, { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE execution_journal (
      operation_id TEXT PRIMARY KEY,
      capability_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      execution_state TEXT NOT NULL,
      verification_state TEXT NOT NULL,
      idempotency_class TEXT NOT NULL,
      idempotency_identity TEXT,
      action_fingerprint TEXT NOT NULL,
      scope_fingerprint TEXT NOT NULL,
      checkpoint_id TEXT,
      parent_operation_id TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      schema_version INTEGER NOT NULL
    )`);
    db.prepare(`INSERT INTO execution_journal VALUES (${Array.from({ length: 15 }, () => '?').join(',')})`).run(
      'operation_schema',
      RECOVERY_SANDBOX_MUTATE,
      'MUTATION',
      'EXECUTING',
      'NOT_STARTED',
      'IDEMPOTENT',
      null,
      'x'.repeat(64),
      'y'.repeat(64),
      null,
      null,
      '{"not":"a-journal-record","executionState":"EXECUTING"}',
      new Date().toISOString(),
      new Date().toISOString(),
      JOURNAL_SCHEMA_VERSION,
    );
    db.close();
    const journal = fileJournal(root);
    assert.equal(journal.failClosed(), true);

    const cleanRoot = tempRoot();
    const clean = fileJournal(cleanRoot);
    authorize(clean, {
      ...sandboxPropose('operation_dup1', 'a'),
      idempotencyClass: 'IDEMPOTENT',
      idempotencyKey: 'same-identity',
    });
    assert.throws(
      () => clean.propose({
        ...sandboxPropose('operation_dup2', 'b'),
        idempotencyClass: 'IDEMPOTENT',
        idempotencyKey: 'same-identity',
      }),
      /different action or scope|Duplicate idempotency/u,
    );
    const parent = authorize(clean, sandboxPropose('operation_bad_rb', 'z'));
    assert.throws(
      () => clean.beginRollback(parent.operationId, 'checkpoint_22222222-2222-2222-2222-222222222222', 'rollback_bad', 'system'),
      /does not exist|required/u,
    );
    fs.rmSync(cleanRoot, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sandbox crash-window CHECKPOINTED restart does not write twice and owner retry is a new authorized pass', async () => {
  const root = tempRoot();
  try {
    const first = recoveryHost(root);
    const operation = { operationId: 'operation_live1', value: 'first-write' };
    const committed = await confirmed(first, RECOVERY_SANDBOX_MUTATE, operation, 'mutation-live-1');
    assert.equal(committed.status, 'ok');
    assert.equal((committed.structured.verification as { state: string }).state, 'VERIFIED');
    const checkpointId = String(committed.structured.checkpointId);
    const restarted = recoveryHost(root);
    const duplicate = await confirmed(restarted, RECOVERY_SANDBOX_MUTATE, operation, 'mutation-live-2');
    assert.equal(duplicate.status, 'ok');
    assert.equal(duplicate.structured.checkpointId, checkpointId);
    assert.equal(duplicate.structured.idempotent, true);
    const rollback = await confirmed(restarted, RECOVERY_SANDBOX_ROLLBACK, {
      checkpointId,
      rollbackId: 'rollback_live1',
    }, 'rollback-live-1');
    assert.equal(rollback.status, 'ok');
    assert.equal(rollback.structured.rollbackVerification, 'ROLLBACK_VERIFIED');
    const journal = fileJournal(root);
    const mutation = journal.get('operation_live1');
    const rollbackRecord = journal.get('rollback_live1');
    assert.ok(mutation);
    assert.ok(rollbackRecord);
    assert.equal(rollbackRecord?.kind, 'ROLLBACK');
    assert.equal(rollbackRecord?.executionState, 'ROLLED_BACK');
    assert.notEqual(mutation?.operationId, rollbackRecord?.operationId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('WorkAgent-style request ids with colons are accepted as journal operation ids', () => {
  const journal = memoryJournal();
  const record = journal.propose({
    ...sandboxPropose('task_abcd1234:apply_reminder', 'when-colon'),
    operationId: 'task_abcd1234:apply_reminder',
  });
  assert.equal(record.operationId.includes(':'), false);
  assert.match(record.operationId, /^[a-z0-9][a-z0-9_-]{7,63}$/u);
});

test('WorkAgent pending duplicate cannot start a second journaled sandbox mutation', () => {
  const journal = memoryJournal();
  const first = journal.propose({
    ...sandboxPropose('operation_agent1', 'once'),
    idempotencyClass: 'IDEMPOTENT',
    idempotencyKey: 'operation_agent1',
    taskId: 'task_waiting_input',
  });
  const second = journal.propose({
    ...sandboxPropose('operation_agent1', 'once'),
    idempotencyClass: 'IDEMPOTENT',
    idempotencyKey: 'operation_agent1',
    taskId: 'task_waiting_input',
  });
  assert.equal(first.operationId, second.operationId);
  assert.equal(first.taskId, 'task_waiting_input');
});

function memoryJournal(): ExecutionJournalCoordinator {
  const root = tempRoot();
  const checkpoints = new RecoveryCheckpointStore(path.join(root, 'recovery', 'checkpoints'));
  return new ExecutionJournalCoordinator({ checkpoints, containment: new FailureContainment() });
}

function fileJournal(root: string): ExecutionJournalCoordinator {
  return new ExecutionJournalCoordinator({
    dbPath: path.join(root, 'execution-journal.db'),
    checkpoints: new RecoveryCheckpointStore(path.join(root, 'recovery', 'checkpoints')),
    containment: new FailureContainment(undefined, () => Date.now(), path.join(root, 'recovery', 'containment.json')),
  });
}

function bindMemoryCheckpoint(journal: ExecutionJournalCoordinator, operationId: string): string {
  const checkpoint = journal.checkpoints!.create({
    capabilityId: RECOVERY_SANDBOX_MUTATE,
    scope: [RECOVERY_SANDBOX_TARGET],
    affectedTargets: [RECOVERY_SANDBOX_TARGET],
    priorState: { exists: false, digest: 'missing' },
  });
  journal.recordCheckpoint(operationId, checkpoint.checkpointId);
  return checkpoint.checkpointId;
}

function authorize(journal: ExecutionJournalCoordinator, input: Parameters<ExecutionJournalCoordinator['propose']>[0]) {
  const record = journal.propose(input);
  if (record.executionState === 'PROPOSED') journal.transition(record.operationId, 'PREFLIGHTED', 'system');
  if (journal.get(record.operationId)?.executionState === 'PREFLIGHTED') {
    journal.transition(record.operationId, 'WAITING_PERMISSION', 'system');
  }
  if (journal.get(record.operationId)?.executionState === 'WAITING_PERMISSION') {
    journal.transition(record.operationId, 'AUTHORIZED', 'system');
  }
  return journal.get(record.operationId)!;
}

function sandboxPropose(operationId: string, value: string) {
  return {
    operationId,
    capabilityId: RECOVERY_SANDBOX_MUTATE,
    action: { operationId, value },
    scope: [RECOVERY_SANDBOX_TARGET],
    idempotencyClass: 'IDEMPOTENT' as const,
    idempotencyKey: operationId,
  };
}

function bindCheckpoint(journal: ExecutionJournalCoordinator, _root: string, operationId: string): string {
  return bindMemoryCheckpoint(journal, operationId);
}

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
) {
  const proposed = await host.invoke({ id, input, source: 'ui', requestId });
  assert.equal(proposed.status, 'confirmation_required');
  return host.confirm({
    proposalId: String(proposed.structured.proposalId),
    token: String(proposed.structured.confirmToken),
    source: 'ui',
    requestId,
  });
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-journal-'));
}

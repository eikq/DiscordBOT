import type { RecoveryCheckpointStore } from '../recovery/checkpointStore';
import type { FailureContainment } from '../safety/failureContainment';
import type { JarvisEventBus } from '../security/eventBus';
import {
  assertPersistableJournalValue,
  fingerprintAction,
  fingerprintScope,
  hashIdempotencyIdentity,
  journalError,
  newJournalOperationId,
  toJournalOperationId,
} from './fingerprints';
import { ExecutionJournalStore, defaultExecutionJournalDbPath } from './store';
import { assertJournalTransition } from './transitions';
import type {
  ExecutionJournalRecord,
  ExecutionJournalState,
  JournalActor,
  JournalIdempotencyClass,
  JournalVerificationState,
  ObservedTargetState,
  ProposeJournalInput,
  RecoveryDisposition,
} from './types';

export type ExecutionJournalOptions = {
  store?: ExecutionJournalStore;
  dbPath?: string;
  now?: () => number;
  checkpoints?: RecoveryCheckpointStore;
  containment?: FailureContainment;
  events?: JarvisEventBus;
};

export type TargetObservation = {
  observed: ObservedTargetState;
  evidenceRef?: string;
};

export type JournalMutationGate = {
  allowed: boolean;
  reasonCode?: string;
  record: ExecutionJournalRecord;
  verifyOnly?: boolean;
};

/**
 * Authoritative persistent journal for mutating capability execution.
 * Persistence is evidence, never permission, privilege, or confirmation.
 */
export class ExecutionJournalCoordinator {
  public readonly store: ExecutionJournalStore;
  public readonly checkpoints?: RecoveryCheckpointStore;
  private readonly now: () => number;
  private readonly retryAuthorized = new Set<string>();
  private readonly sessionMutationAllowed = new Set<string>();
  private readonly containment?: FailureContainment;
  private readonly events?: JarvisEventBus;

  public constructor(options: ExecutionJournalOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.store = options.store ?? new ExecutionJournalStore({
      dbPath: options.dbPath,
      now: this.now,
    });
    this.checkpoints = options.checkpoints;
    this.containment = options.containment;
    this.events = options.events;
  }

  public failClosed(): boolean {
    return this.store.failClosed;
  }

  public get(operationId: string): ExecutionJournalRecord | undefined {
    return this.store.get(operationId);
  }

  public discoverActive(): ExecutionJournalRecord[] {
    if (this.store.failClosed) {
      throw journalError('JOURNAL_FAIL_CLOSED', this.store.failClosedReason || 'Corrupt active journal is fail-closed.');
    }
    return this.store.active();
  }

  public propose(input: ProposeJournalInput): ExecutionJournalRecord {
    this.assertWritable();
    const idempotencyClass = input.idempotencyClass ?? 'UNKNOWN';
    const identity = identityFor(idempotencyClass, input.idempotencyKey);
    if (identity) {
      const existing = this.store.findByIdempotency(input.capabilityId, identity);
      if (existing) {
        const actionFingerprint = fingerprintAction(input.capabilityId, input.action);
        const scopeFingerprint = fingerprintScope(input.scope);
        if (existing.actionFingerprint !== actionFingerprint || existing.scopeFingerprint !== scopeFingerprint) {
          throw journalError(
            'JOURNAL_IDEMPOTENCY_CONFLICT',
            'Duplicate idempotency identity with a different action or scope was rejected.',
          );
        }
        return existing;
      }
    }
    const at = iso(this.now());
    const record: ExecutionJournalRecord = {
      operationId: toJournalOperationId(input.operationId?.trim() || newJournalOperationId()),
      kind: input.kind ?? 'MUTATION',
      capabilityId: input.capabilityId,
      ...(input.goalId ? { goalId: input.goalId } : {}),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.stepId ? { stepId: input.stepId } : {}),
      actionFingerprint: fingerprintAction(input.capabilityId, input.action),
      scopeFingerprint: fingerprintScope(input.scope),
      idempotencyClass,
      ...(identity ? { idempotencyIdentity: identity } : {}),
      ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
      ...(input.parentOperationId ? { parentOperationId: input.parentOperationId } : {}),
      executionState: 'PROPOSED',
      verificationState: 'NOT_STARTED',
      evidenceRefs: [],
      recoveryDisposition: 'NONE',
      createdAt: at,
      updatedAt: at,
    };
    const saved = this.store.put(record);
    this.emit('JOURNAL_PROPOSED', 'Mutating capability operation recorded in the execution journal.', saved);
    return saved;
  }

  public transition(
    operationId: string,
    next: ExecutionJournalState,
    actor: JournalActor,
    patch: Partial<Pick<ExecutionJournalRecord, 'verificationState' | 'cancellationState' | 'containmentIncidentId' | 'recoveryDisposition' | 'checkpointId' | 'evidenceRefs'>> = {},
  ): ExecutionJournalRecord {
    this.assertWritable();
    const current = this.require(operationId);
    assertJournalTransition(current.executionState, next, actor);
    const verificationState = patch.verificationState ?? verificationFor(next, current.verificationState);
    const nextRecord: ExecutionJournalRecord = {
      ...current,
      executionState: next,
      verificationState,
      updatedAt: iso(this.now()),
      ...(patch.cancellationState ? { cancellationState: patch.cancellationState } : {}),
      ...(patch.containmentIncidentId ? { containmentIncidentId: patch.containmentIncidentId } : {}),
      ...(patch.recoveryDisposition ? { recoveryDisposition: patch.recoveryDisposition } : {}),
      ...(patch.checkpointId ? { checkpointId: patch.checkpointId } : {}),
      evidenceRefs: patch.evidenceRefs ? [...current.evidenceRefs, ...patch.evidenceRefs].slice(-32) : current.evidenceRefs,
    };
    const saved = this.store.put(nextRecord);
    if (next === 'CHECKPOINTED' || next === 'EXECUTING' || next === 'ROLLING_BACK') {
      this.sessionMutationAllowed.add(operationId);
    }
    this.emit('JOURNAL_STATE', `Execution journal moved to ${next}.`, saved);
    return saved;
  }

  public recordEvidence(
    operationId: string,
    evidenceRefs: string[],
    actor: JournalActor = 'system',
  ): ExecutionJournalRecord {
    this.assertWritable();
    if (actor === 'model' || actor === 'jarvis') {
      throw journalError('MODEL_CANNOT_SET_JOURNAL_STATE', 'Model identity cannot write authoritative execution journal evidence.');
    }
    const current = this.require(operationId);
    const evidence = [...new Set(evidenceRefs.map(item => String(item).trim()).filter(Boolean))].slice(-32);
    if (evidence.length === 0) return current;
    assertPersistableJournalValue({ evidenceRefs: evidence }, 'journal evidence');
    const saved = this.store.put({
      ...current,
      evidenceRefs: mergeEvidence(current.evidenceRefs, evidence),
      updatedAt: iso(this.now()),
    });
    this.emit('JOURNAL_RECONCILED', 'Execution journal recorded external runtime evidence without changing authority or state.', saved);
    return saved;
  }
  public recordCheckpoint(operationId: string, checkpointId: string, actor: JournalActor = 'system'): ExecutionJournalRecord {
    this.assertWritable();
    const current = this.require(operationId);
    if (!this.checkpoints) {
      throw journalError('CHECKPOINT_REQUIRED', 'A recovery checkpoint store is required before mutation.');
    }
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw journalError('CHECKPOINT_REQUIRED', 'Journal mutation requires an existing recovery checkpoint.');
    }
    const checkpointScope = fingerprintScope([...checkpoint.scope, ...checkpoint.affectedTargets]);
    if (checkpointScope !== current.scopeFingerprint && fingerprintScope(checkpoint.affectedTargets) !== current.scopeFingerprint) {
      throw journalError('CHECKPOINT_SCOPE_MISMATCH', 'Checkpoint scope does not match the journaled action.');
    }
    if (checkpoint.capabilityId !== current.capabilityId) {
      throw journalError('CHECKPOINT_SCOPE_MISMATCH', 'Checkpoint capability does not match the journaled action.');
    }
    const bound = this.store.findByCheckpoint(checkpointId)
      .filter(item => item.operationId !== operationId && item.kind === 'MUTATION');
    if (bound.some(item => ['EXECUTING', 'MUTATED', 'VERIFYING', 'VERIFIED', 'COMPLETED'].includes(item.executionState))) {
      throw journalError('CHECKPOINT_REPLAY_BLOCKED', 'A consumed or already-replayed checkpoint cannot authorize another mutation.');
    }
    if (checkpoint.state === 'CONSUMED' || checkpoint.state === 'EXPIRED' || checkpoint.state === 'INVALID' || checkpoint.state === 'FAILED') {
      throw journalError('CHECKPOINT_REPLAY_BLOCKED', 'A consumed or invalid checkpoint cannot authorize mutation.');
    }
    const from = current.executionState;
    const checkpointing = from === 'CHECKPOINTING' ? current : this.transition(operationId, from === 'AUTHORIZED' ? 'CHECKPOINTING' : from, actor);
    if (checkpointing.executionState === 'CHECKPOINTING') {
      const checkpointed = this.transition(operationId, 'CHECKPOINTED', actor, { checkpointId });
      this.sessionMutationAllowed.add(operationId);
      return checkpointed;
    }
    if (checkpointing.executionState === 'CHECKPOINTED') {
      this.sessionMutationAllowed.add(operationId);
      return this.store.put({ ...checkpointing, checkpointId, updatedAt: iso(this.now()) });
    }
    throw journalError('JOURNAL_TRANSITION_FORBIDDEN', 'Checkpoint cannot be bound in the current journal state.');
  }

  public authorizeRetry(operationId: string, actor: JournalActor): ExecutionJournalRecord {
    if (actor !== 'owner') {
      throw journalError('OWNER_RETRY_REQUIRED', 'Only an explicit owner action may retry a checkpointed mutation.');
    }
    const current = this.require(operationId);
    if (current.executionState !== 'CHECKPOINTED') {
      throw journalError('JOURNAL_TRANSITION_FORBIDDEN', 'Explicit retry is only offered from CHECKPOINTED.');
    }
    this.retryAuthorized.add(operationId);
    return current;
  }

  public mutationGate(operationId: string): JournalMutationGate {
    const record = this.require(operationId);
    if (this.store.failClosed) {
      return { allowed: false, reasonCode: 'JOURNAL_FAIL_CLOSED', record };
    }
    if (record.executionState === 'MUTATED' || record.executionState === 'VERIFYING' || record.executionState === 'VERIFIED' || record.executionState === 'PARTIALLY_VERIFIED' || record.executionState === 'FAILED_VERIFICATION') {
      return { allowed: false, verifyOnly: true, reasonCode: 'VERIFY_ONLY', record };
    }
    if (record.executionState === 'COMPLETED' || record.executionState === 'ROLLED_BACK') {
      if (record.idempotencyClass === 'IDEMPOTENT') {
        return { allowed: false, verifyOnly: true, reasonCode: 'JOURNAL_TERMINAL', record };
      }
      return { allowed: false, reasonCode: 'JOURNAL_TERMINAL', record };
    }
    if (record.executionState === 'CANCELLED' || record.executionState === 'FAILED' || record.executionState === 'ROLLBACK_FAILED') {
      return { allowed: false, reasonCode: 'JOURNAL_TERMINAL', record };
    }
    if (record.executionState === 'AMBIGUOUS' || record.executionState === 'CONTAINED') {
      return { allowed: false, reasonCode: 'JOURNAL_CONTAINED', record };
    }
    const firstPass = this.sessionMutationAllowed.has(operationId);
    const ownerRetry = this.retryAuthorized.has(operationId);
    if (record.executionState === 'CHECKPOINTED') {
      if (firstPass || ownerRetry) {
        if (!firstPass && record.idempotencyClass === 'UNKNOWN') {
          return { allowed: false, reasonCode: 'UNKNOWN_IDEMPOTENCY_NO_REPLAY', record };
        }
        if (!firstPass && record.idempotencyClass === 'NON_IDEMPOTENT') {
          return { allowed: false, reasonCode: 'NON_IDEMPOTENT_NO_REPLAY', record };
        }
        return { allowed: true, record };
      }
      return { allowed: false, reasonCode: 'CHECKPOINT_RETRY_NOT_AUTHORIZED', record };
    }
    if (record.idempotencyClass === 'UNKNOWN' && record.executionState === 'EXECUTING' && !firstPass) {
      return { allowed: false, reasonCode: 'UNKNOWN_IDEMPOTENCY_NO_REPLAY', record };
    }
    if (record.executionState === 'EXECUTING' && !firstPass) {
      return { allowed: false, reasonCode: 'UNKNOWN_IDEMPOTENCY_NO_REPLAY', record };
    }
    if (record.idempotencyClass === 'NON_IDEMPOTENT' && ['MUTATED', 'VERIFIED', 'COMPLETED'].includes(record.executionState)) {
      return { allowed: false, reasonCode: 'NON_IDEMPOTENT_NO_REPLAY', record };
    }
    if (record.executionState === 'AUTHORIZED' || record.executionState === 'CHECKPOINTING' || record.executionState === 'EXECUTING' || record.executionState === 'ROLLBACK_PENDING' || record.executionState === 'ROLLING_BACK') {
      return { allowed: true, record };
    }
    if (record.executionState === 'PREFLIGHTED' || record.executionState === 'WAITING_PERMISSION' || record.executionState === 'PROPOSED') {
      return { allowed: false, reasonCode: 'JOURNAL_NOT_AUTHORIZED', record };
    }
    return { allowed: false, reasonCode: 'JOURNAL_TRANSITION_FORBIDDEN', record };
  }

  public reconcile(operationId: string, observation: TargetObservation, actor: JournalActor = 'system'): ExecutionJournalRecord {
    this.assertWritable();
    let record = this.require(operationId);
    const evidence = observation.evidenceRef ? [observation.evidenceRef] : [];
    if (record.executionState === 'CHECKPOINTED') {
      if (observation.observed === 'PRIOR') {
        return this.store.put({
          ...record,
          recoveryDisposition: 'RETRY_OFFERED',
          updatedAt: iso(this.now()),
          evidenceRefs: mergeEvidence(record.evidenceRefs, evidence),
        });
      }
      if (observation.observed === 'INTENDED') {
        record = this.transition(operationId, 'MUTATED', actor, {
          recoveryDisposition: 'VERIFY_ONLY',
          evidenceRefs: evidence,
        });
        return this.transition(operationId, 'VERIFYING', actor, { recoveryDisposition: 'VERIFY_ONLY' });
      }
      return this.contain(operationId, actor, 'Interrupted checkpoint matches neither prior nor intended state.', evidence);
    }
    if (record.executionState === 'EXECUTING') {
      if (observation.observed === 'INTENDED') {
        record = this.transition(operationId, 'MUTATED', actor, { recoveryDisposition: 'VERIFY_ONLY', evidenceRefs: evidence });
        return this.transition(operationId, 'VERIFYING', actor, { recoveryDisposition: 'VERIFY_ONLY' });
      }
      if (observation.observed === 'PRIOR') {
        record = this.transition(operationId, 'AMBIGUOUS', actor, {
          recoveryDisposition: 'INTERRUPTED_BEFORE_COMMIT',
          evidenceRefs: evidence,
        });
        return this.contain(operationId, actor, 'EXECUTING restart cannot prove a commit.', evidence);
      }
      return this.contain(operationId, actor, 'EXECUTING restart cannot prove commit or prior state.', evidence);
    }
    if (record.executionState === 'MUTATED' || record.executionState === 'VERIFYING') {
      if (observation.observed === 'INTENDED') {
        if (record.executionState === 'MUTATED') {
          return this.transition(operationId, 'VERIFYING', actor, { recoveryDisposition: 'VERIFY_ONLY', evidenceRefs: evidence });
        }
        return this.store.put({
          ...record,
          recoveryDisposition: 'VERIFY_ONLY',
          updatedAt: iso(this.now()),
          evidenceRefs: mergeEvidence(record.evidenceRefs, evidence),
        });
      }
      return this.contain(operationId, actor, 'Mutated target matches neither prior nor intended state.', evidence);
    }
    if (record.executionState === 'ROLLING_BACK') {
      if (observation.observed === 'PRIOR') {
        return this.store.put({
          ...record,
          recoveryDisposition: 'VERIFY_ONLY',
          updatedAt: iso(this.now()),
          evidenceRefs: mergeEvidence(record.evidenceRefs, evidence),
        });
      }
      return this.contain(operationId, actor, 'Rollback restart cannot blindly restore again.', evidence);
    }
    return record;
  }

  public recordVerification(operationId: string, state: JournalVerificationState, actor: JournalActor = 'system'): ExecutionJournalRecord {
    let current = this.require(operationId);
    if (state === 'VERIFIED') {
      if (current.kind === 'ROLLBACK') {
        if (current.executionState === 'ROLLING_BACK') {
          return this.transition(operationId, 'ROLLED_BACK', actor, {
            verificationState: 'VERIFIED',
            recoveryDisposition: 'NONE',
          });
        }
        return current;
      }
      if (current.executionState === 'MUTATED') {
        current = this.transition(operationId, 'VERIFYING', actor, { verificationState: 'UNVERIFIED' });
      }
      if (current.executionState === 'VERIFYING' || current.executionState === 'PARTIALLY_VERIFIED' || current.executionState === 'FAILED_VERIFICATION') {
        return this.transition(operationId, 'VERIFIED', actor, {
          verificationState: 'VERIFIED',
          recoveryDisposition: current.goalId ? 'STEP_VERIFIED_GOAL_OPEN' : 'ROLLBACK_AVAILABLE',
        });
      }
      return current;
    }
    if (state === 'PARTIALLY_VERIFIED') {
      return this.transition(operationId, 'PARTIALLY_VERIFIED', actor, { verificationState: state });
    }
    if (state === 'FAILED_VERIFICATION') {
      return this.transition(operationId, 'FAILED_VERIFICATION', actor, { verificationState: state });
    }
    return current;
  }

  public complete(operationId: string, actor: JournalActor = 'system'): ExecutionJournalRecord {
    const current = this.require(operationId);
    if (current.executionState === 'VERIFIED') {
      return this.transition(operationId, 'COMPLETED', actor, { recoveryDisposition: 'ROLLBACK_AVAILABLE' });
    }
    if (current.executionState === 'ROLLED_BACK') {
      return this.transition(operationId, 'COMPLETED', actor);
    }
    throw journalError('JOURNAL_TRANSITION_FORBIDDEN', 'Only verified mutations or rollbacks may complete.');
  }

  public beginRollback(
    parentOperationId: string,
    checkpointId: string,
    rollbackOperationId: string,
    actor: JournalActor,
    rollbackCapabilityId?: string,
  ): ExecutionJournalRecord {
    this.assertWritable();
    const parent = this.require(parentOperationId);
    if (parent.kind !== 'MUTATION') {
      throw journalError('ROLLBACK_PARENT_INVALID', 'Rollback must reference a mutation operation.');
    }
    if (!this.checkpoints) {
      throw journalError('CHECKPOINT_REQUIRED', 'Rollback requires a recovery checkpoint.');
    }
    const checkpoint = this.checkpoints.get(checkpointId);
    if (!checkpoint) {
      throw journalError('CHECKPOINT_REQUIRED', 'Rollback checkpoint does not exist.');
    }
    if (checkpoint.state === 'INVALID' || checkpoint.state === 'EXPIRED' || checkpoint.state === 'FAILED') {
      throw journalError('CHECKPOINT_REQUIRED', 'Rollback checkpoint is not valid.');
    }
    if (parent.checkpointId && parent.checkpointId !== checkpointId) {
      throw journalError('CHECKPOINT_SCOPE_MISMATCH', 'Rollback checkpoint does not belong to the parent operation.');
    }
    if (fingerprintScope(checkpoint.affectedTargets) !== parent.scopeFingerprint
      && fingerprintScope([...checkpoint.scope, ...checkpoint.affectedTargets]) !== parent.scopeFingerprint) {
      throw journalError('CHECKPOINT_SCOPE_MISMATCH', 'Rollback checkpoint scope does not match the parent operation.');
    }
    const existing = this.store.get(rollbackOperationId)
      ?? this.store.findByIdempotency(
        rollbackCapabilityId ?? parent.capabilityId,
        hashIdempotencyIdentity(`rollback:${parentOperationId}:${checkpointId}`),
      );
    if (existing) return existing;
    const proposed = this.propose({
      operationId: rollbackOperationId,
      kind: 'ROLLBACK',
      capabilityId: rollbackCapabilityId ?? parent.capabilityId,
      action: { rollbackOf: parentOperationId, checkpointId },
      scope: [...checkpoint.affectedTargets],
      idempotencyClass: 'IDEMPOTENT',
      idempotencyKey: `rollback:${parentOperationId}:${checkpointId}`,
      parentOperationId,
      checkpointId,
    });
    this.transition(proposed.operationId, 'PREFLIGHTED', actor);
    return this.transition(proposed.operationId, 'WAITING_PERMISSION', actor);
  }

  public markEmergencyStop(operationId: string, actor: JournalActor = 'system'): ExecutionJournalRecord {
    const current = this.require(operationId);
    if (current.executionState === 'COMPLETED' || current.executionState === 'CANCELLED' || current.executionState === 'CONTAINED') {
      return current;
    }
    const requested = ['EXECUTING', 'MUTATED', 'VERIFYING', 'CHECKPOINTING', 'CHECKPOINTED', 'AUTHORIZED', 'WAITING_PERMISSION', 'ROLLING_BACK'].includes(current.executionState)
      ? this.transition(operationId, current.executionState === 'CANCELLATION_REQUESTED' ? 'CANCELLATION_REQUESTED' : 'CANCELLATION_REQUESTED', actor, {
          cancellationState: 'CANCELLATION_REQUESTED',
          recoveryDisposition: 'EMERGENCY_STOP',
        })
      : current;
    return requested;
  }

  public noteEmergencyResume(actor: JournalActor): void {
    if (actor !== 'owner') {
      throw journalError('OWNER_RESUME_REQUIRED', 'Emergency Resume does not auto-resume journaled mutation.');
    }
    this.retryAuthorized.clear();
  }

  public grantPermission(): never {
    throw journalError('JOURNAL_NOT_PERMISSION', 'The execution journal cannot grant permission or privilege.');
  }

  public reviveLease(): never {
    throw journalError('JOURNAL_NOT_PERMISSION', 'The execution journal cannot revive an expired privilege lease.');
  }

  private contain(operationId: string, actor: JournalActor, reason: string, evidence: string[]): ExecutionJournalRecord {
    const current = this.require(operationId);
    const ambiguous = current.executionState === 'AMBIGUOUS'
      ? current
      : this.transition(operationId, 'AMBIGUOUS', actor, { recoveryDisposition: 'OWNER_REVIEW', evidenceRefs: evidence });
    const incident = this.containment?.observe({
      capabilityId: ambiguous.capabilityId,
      preflight: {
        id: `journal-${ambiguous.operationId}`,
        createdAt: iso(this.now()),
        action: ambiguous.capabilityId,
        why: reason,
        risk: 'HIGH',
        possibleImpact: ['Interrupted mutation may have an unknown remaining effect.'],
        expectedChanges: [],
        protection: ['Fail closed', 'Owner review required', 'No blind retry'],
        reversible: true,
        reviewRequired: true,
        blocked: true,
        reasonCodes: ['MUTATION_OUTCOME_UNKNOWN'],
        effects: [{
          kind: 'MODIFY',
          description: reason,
          destructive: false,
          reversible: true,
          privilege: 'owner_approval',
          targets: [ambiguous.capabilityId],
        }],
        affectedTargets: [ambiguous.capabilityId],
        privilegeRequired: 'owner_approval',
        permissionScope: [ambiguous.capabilityId],
        rollback: { state: 'AVAILABLE', strategy: 'Owner review; do not blindly retry mutation.', checkpointId: ambiguous.checkpointId },
      },
      result: {
        capabilityId: ambiguous.capabilityId,
        status: 'error',
        structured: { status: 'error', reasonCode: 'MUTATION_OUTCOME_UNKNOWN' },
        content: reason,
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'write',
        error: reason,
      },
      recovery: { state: 'AVAILABLE', strategy: 'Owner review; do not blindly retry mutation.', checkpointId: ambiguous.checkpointId },
      taskId: ambiguous.taskId,
      stepId: ambiguous.stepId,
    });
    return this.transition(operationId, 'CONTAINED', actor, {
      containmentIncidentId: incident?.id,
      recoveryDisposition: 'CONTAINED',
      evidenceRefs: evidence,
    });
  }

  private require(operationId: string): ExecutionJournalRecord {
    const record = this.store.get(operationId);
    if (!record) throw journalError('JOURNAL_UNKNOWN_OPERATION', 'Unknown journal operation.');
    return record;
  }

  private assertWritable(): void {
    if (this.store.failClosed) {
      throw journalError('JOURNAL_FAIL_CLOSED', this.store.failClosedReason || 'Corrupt active journal is fail-closed.');
    }
  }

  private emit(type: 'JOURNAL_PROPOSED' | 'JOURNAL_STATE' | 'JOURNAL_RECONCILED', message: string, record: ExecutionJournalRecord): void {
    this.events?.emit(type, message, {
      operationId: record.operationId,
      capabilityId: record.capabilityId,
      executionState: record.executionState,
      verificationState: record.verificationState,
      recoveryDisposition: record.recoveryDisposition,
    }, record.executionState === 'CONTAINED' || record.executionState === 'AMBIGUOUS' ? 'error' : 'info', {
      taskId: record.taskId,
    });
  }
}

function identityFor(classification: JournalIdempotencyClass, raw?: string): string | undefined {
  if (classification !== 'IDEMPOTENT' || !raw) return undefined;
  return hashIdempotencyIdentity(raw);
}

function verificationFor(next: ExecutionJournalState, current: JournalVerificationState): JournalVerificationState {
  if (next === 'VERIFYING') return 'UNVERIFIED';
  if (next === 'VERIFIED' || next === 'COMPLETED' || next === 'ROLLED_BACK') return 'VERIFIED';
  if (next === 'PARTIALLY_VERIFIED') return 'PARTIALLY_VERIFIED';
  if (next === 'FAILED_VERIFICATION') return 'FAILED_VERIFICATION';
  return current;
}

function mergeEvidence(current: string[], extra: string[]): string[] {
  return [...current, ...extra].slice(-32);
}

function iso(now: number): string {
  return new Date(now).toISOString();
}

export { defaultExecutionJournalDbPath };

export const EXECUTION_JOURNAL_STATES = [
  'PROPOSED',
  'PREFLIGHTED',
  'WAITING_PERMISSION',
  'AUTHORIZED',
  'CHECKPOINTING',
  'CHECKPOINTED',
  'EXECUTING',
  'MUTATED',
  'VERIFYING',
  'VERIFIED',
  'PARTIALLY_VERIFIED',
  'FAILED_VERIFICATION',
  'CANCELLATION_REQUESTED',
  'CANCELLED',
  'FAILED',
  'AMBIGUOUS',
  'CONTAINED',
  'ROLLBACK_PENDING',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
  'COMPLETED',
] as const;

export type ExecutionJournalState = (typeof EXECUTION_JOURNAL_STATES)[number];

export const JOURNAL_TERMINAL_STATES: readonly ExecutionJournalState[] = [
  'COMPLETED',
  'CANCELLED',
  'FAILED',
  'CONTAINED',
  'ROLLED_BACK',
  'ROLLBACK_FAILED',
];

export const JOURNAL_ACTIVE_STATES: readonly ExecutionJournalState[] = EXECUTION_JOURNAL_STATES.filter(
  state => !JOURNAL_TERMINAL_STATES.includes(state),
);

export type JournalIdempotencyClass = 'IDEMPOTENT' | 'NON_IDEMPOTENT' | 'UNKNOWN';
export type JournalKind = 'MUTATION' | 'ROLLBACK';
export type JournalActor = 'owner' | 'system' | 'model' | 'jarvis';
export type ObservedTargetState = 'PRIOR' | 'INTENDED' | 'NEITHER' | 'UNKNOWN';
export type JournalVerificationState =
  | 'NOT_STARTED'
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'PARTIALLY_VERIFIED'
  | 'FAILED_VERIFICATION'
  | 'NOT_APPLICABLE';

export type RecoveryDisposition =
  | 'NONE'
  | 'RETRY_OFFERED'
  | 'VERIFY_ONLY'
  | 'OWNER_REVIEW'
  | 'CONTAINED'
  | 'ROLLBACK_AVAILABLE'
  | 'INTERRUPTED_BEFORE_COMMIT'
  | 'EMERGENCY_STOP'
  | 'STEP_VERIFIED_GOAL_OPEN';

export type ExecutionJournalRecord = {
  operationId: string;
  kind: JournalKind;
  capabilityId: string;
  goalId?: string;
  taskId?: string;
  stepId?: string;
  actionFingerprint: string;
  scopeFingerprint: string;
  idempotencyClass: JournalIdempotencyClass;
  idempotencyIdentity?: string;
  checkpointId?: string;
  parentOperationId?: string;
  executionState: ExecutionJournalState;
  verificationState: JournalVerificationState;
  cancellationState?: string;
  containmentIncidentId?: string;
  evidenceRefs: string[];
  recoveryDisposition: RecoveryDisposition;
  createdAt: string;
  updatedAt: string;
};

export type ProposeJournalInput = {
  operationId?: string;
  kind?: JournalKind;
  capabilityId: string;
  goalId?: string;
  taskId?: string;
  stepId?: string;
  action: unknown;
  scope: string[];
  idempotencyClass?: JournalIdempotencyClass;
  idempotencyKey?: string;
  parentOperationId?: string;
  checkpointId?: string;
};

export const JOURNAL_SCHEMA_VERSION = 1;
export const JOURNAL_OPERATION_ID_PATTERN = /^journal_[0-9a-f]{16,64}$|^[a-z0-9][a-z0-9_-]{7,63}$/u;
export const FORBIDDEN_JOURNAL_KEYS = [
  'confirmToken',
  'confirmationToken',
  'token',
  'privilegeGrant',
  'privilege',
  'lease',
  'leaseToken',
  'cookie',
  'cookies',
  'authorization',
  'credential',
  'credentials',
  'password',
  'secret',
  'hiddenState',
  'grant',
] as const;

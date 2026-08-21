export type RecoveryCheckpointState =
  | 'CREATED'
  | 'AVAILABLE'
  | 'CONSUMED'
  | 'INVALID'
  | 'EXPIRED'
  | 'FAILED';

export type RollbackVerificationState =
  | 'ROLLBACK_VERIFIED'
  | 'ROLLBACK_PARTIAL'
  | 'ROLLBACK_FAILED'
  | 'ROLLBACK_UNVERIFIED';

export type RecoveryCheckpoint = {
  checkpointId: string;
  capabilityId: string;
  taskId?: string;
  stepId?: string;
  createdAt: string;
  expiresAt?: string;
  scope: string[];
  affectedTargets: string[];
  priorStateRef: string;
  integrity: { algorithm: 'sha256'; digest: string };
  state: RecoveryCheckpointState;
  consumedAt?: string;
  rollbackVerification?: RollbackVerificationState;
};

export type CreateCheckpointInput = {
  capabilityId: string;
  taskId?: string;
  stepId?: string;
  scope: string[];
  affectedTargets: string[];
  priorState: unknown;
  retentionMs?: number;
};

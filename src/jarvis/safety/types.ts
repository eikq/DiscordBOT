export type OperationalRiskLevel = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ActionEffectKind =
  | 'READ'
  | 'CREATE'
  | 'MODIFY'
  | 'OVERWRITE'
  | 'DELETE'
  | 'MOVE'
  | 'RENAME'
  | 'REMOVE_DIRECTORY'
  | 'GIT_DESTRUCTIVE'
  | 'SYSTEM_SECURITY_CHANGE'
  | 'DISK_OPERATION'
  | 'CREDENTIAL_CHANGE'
  | 'PERMISSION_CHANGE'
  | 'PACKAGE_CHANGE'
  | 'PROCESS_CONTROL'
  | 'SERVICE_CONTROL'
  | 'APPLICATION_LAUNCH'
  | 'NETWORK_ACCESS'
  | 'DATA_CHANGE'
  | 'UNKNOWN_MUTATION';

export type ActionPrivilege = 'standard_user' | 'owner_approval' | 'elevated' | 'admin' | 'unknown';

/**
 * Capability-authored effect metadata. Dynamic values are resolved only from
 * validated capability input; the model cannot supply effect classifications.
 */
export type ActionEffectTemplate = {
  kind: ActionEffectKind;
  description: string;
  destructive: boolean;
  reversible: boolean;
  privilege: ActionPrivilege;
  riskLevel?: OperationalRiskLevel;
  targets?: string[];
  targetInputFields?: string[];
  estimatedAffectedObjects?: number;
  countInputField?: string;
  massChangePolicy?: 'normal' | 'bounded_generated_output';
};

export type ActionEffect = Omit<ActionEffectTemplate, 'targetInputFields' | 'countInputField'> & {
  targets: string[];
  estimatedAffectedObjects?: number;
};

export type VerificationState =
  | 'VERIFIED'
  | 'PARTIALLY_VERIFIED'
  | 'UNVERIFIED'
  | 'FAILED_VERIFICATION'
  | 'NOT_APPLICABLE';

export type RollbackState = 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' | 'NOT_REQUIRED' | 'FAILED';

export type CapabilityVerificationSpec = {
  mode: 'not_applicable' | 'handler_result' | 'structured_postcondition';
  description: string;
  structuredField?: string;
  expectedValue?: unknown;
};

export type CapabilityRollbackSpec = {
  mode: 'not_required' | 'recorded_checkpoint' | 'manual_recovery';
  strategy: string;
  checkpointField?: string;
  priorStateField?: string;
  recoveryInstructions?: string;
};

export type VerificationRecord = {
  state: VerificationState;
  strategy: string;
  requested: string;
  executed: string;
  evidence: string[];
  failedChecks: string[];
  verifiedAt: string;
};

export type RollbackContract = {
  state: RollbackState;
  strategy: string;
  checkpointId?: string;
  backupPathReference?: string;
  priorStateReference?: string;
  recoveryInstructions?: string;
};

export type ActionPreflight = {
  id: string;
  createdAt: string;
  action: string;
  why: string;
  risk: OperationalRiskLevel;
  possibleImpact: string[];
  affectedTargets: string[];
  expectedChanges: string[];
  protection: string[];
  reversible: boolean;
  rollback: RollbackContract;
  privilegeRequired: ActionPrivilege;
  permissionScope: string[];
  reviewRequired: boolean;
  blocked: boolean;
  reasonCodes: string[];
  effects: ActionEffect[];
};

export type CircuitBreakerThresholds = {
  deleteObjects: number;
  moveOrRenameObjects: number;
  modifyObjects: number;
};

export type CircuitBreakerDecision = {
  risk: OperationalRiskLevel;
  reviewRequired: boolean;
  blocked: boolean;
  reasonCodes: string[];
  possibleImpact: string[];
};

export type PrivilegeActor =
  | 'owner'
  | 'jarvis'
  | 'model'
  | 'webpage'
  | 'skill'
  | 'system';

export type PrivilegeLease = {
  id: string;
  issuedAt: string;
  expiresAt: string;
  capabilityIds: string[];
  resourceScopes: string[];
  maxActions: number;
  remainingActions: number;
  reason: string;
  ownerApproved: boolean;
  revokedAt?: string;
  consumedAt?: string;
  taskId?: string;
  stepId?: string;
  risk?: 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  approvalProvenance?: {
    actor: 'owner';
    approvedAt: string;
    proposalId?: string;
    requestId?: string;
  };
};

export type PrivilegeLeaseState = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'CONSUMED';

export type PrivilegeLeaseInventoryItem = PrivilegeLease & {
  state: PrivilegeLeaseState;
};

export type PrivilegeDecision =
  | { ok: true; lease: PrivilegeLease }
  | { ok: false; reasonCode: string; userMessage: string };

export type IssueLeaseInput = {
  capabilityIds: string[];
  resourceScopes: string[];
  reason: string;
  ttlMs?: number;
  maxActions?: number;
  ownerApproved?: boolean;
  taskId?: string;
  stepId?: string;
  risk?: PrivilegeLease['risk'];
  approvalProvenance?: Omit<NonNullable<PrivilegeLease['approvalProvenance']>, 'actor' | 'approvedAt'>;
};

export type HostControlState = 'ON' | 'OFF' | 'UNKNOWN';

export type EncryptionStatus = 'OFF' | 'ON' | 'UNKNOWN';

export type HostSecuritySnapshot = {
  probedAt: string;
  privilege: 'standard_user' | 'elevated' | 'unknown';
  encryption: {
    status: EncryptionStatus;
    method: string;
    modified: false;
    ownerActionRequired: boolean;
    note: string;
  };
  defender: { state: HostControlState; detail: string };
  firewall: { state: HostControlState; detail: string };
  tamperProtection: { state: HostControlState; detail: string };
  memoryIntegrity: { state: HostControlState; detail: string };
  virtualizationBasedSecurity: { state: HostControlState; detail: string };
  secureBoot: { state: HostControlState; detail: string };
  uac: { state: HostControlState; detail: string };
  weakenedByJarvis: false;
};

export type JarvisOperationEventType =
  | 'HOST_SECURITY_CHECK'
  | 'VIRTUALBOX_CHECK'
  | 'WHONIX_VERIFY'
  | 'WHONIX_IMPORT'
  | 'GATEWAY_START'
  | 'WORKSTATION_START'
  | 'PRIVATE_ROUTE_CHECK'
  | 'BROWSER_START'
  | 'BROWSER_DESTROY'
  | 'SEARCH'
  | 'NAVIGATE'
  | 'SOURCE'
  | 'EVIDENCE'
  | 'BLOCKED_LOCAL_NETWORK'
  | 'BLOCKED_DOWNLOAD'
  | 'PROMPT_INJECTION'
  | 'CAPABILITY_REQUEST'
  | 'PRIVILEGE_REQUEST'
  | 'PRIVILEGE_APPROVED'
  | 'PRIVILEGE_DENIED'
  | 'EXPERIENCE_CREATED'
  | 'REFLECTION'
  | 'SKILL_PROPOSED'
  | 'SKILL_TESTED'
  | 'SKILL_PROMOTED'
  | 'CANDIDATE_REJECTED'
  | 'UNDERSTANDING'
  | 'PLANNING'
  | 'COMPARE'
  | 'VERIFY'
  | 'MODEL'
  | 'ERROR'
  | 'TASK_RECEIVED'
  | 'TASK_STEP'
  | 'TASK_RETRY'
  | 'TASK_CANCELLED'
  | 'TASK_BLOCKED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'PERMISSION_WAITING'
  | 'NIGHT_CYCLE'
  | 'AFFECT'
  | 'MONITOR'
  | 'DEVICE'
  | 'VISION'
  | 'SIMULATION'
  | 'CANCELLED'
  | 'PROGRESS'
  | 'SPEECH'
  | 'LISTENING'
  | 'MEMORY'
  | 'WORKSPACE'
  | 'RISK_ASSESSED'
  | 'PREFLIGHT_CREATED'
  | 'PERMISSION_REQUESTED'
  | 'PERMISSION_GRANTED'
  | 'PERMISSION_DENIED'
  | 'LEASE_CREATED'
  | 'LEASE_REVOKED'
  | 'ACTION_STARTED'
  | 'ACTION_COMPLETED'
  | 'ACTION_CANCEL_REQUESTED'
  | 'ACTION_CANCELLED'
  | 'ACTION_CANCEL_FAILED'
  | 'CHECKPOINT_CREATED'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_COMPLETED'
  | 'ROLLBACK_AVAILABLE'
  | 'ROLLBACK_REQUESTED'
  | 'ROLLBACK_STARTED'
  | 'ROLLBACK_COMPLETED'
  | 'ROLLBACK_VERIFIED'
  | 'EMERGENCY_STOP'
  | 'EMERGENCY_RESUME'
  | 'FAILURE_CONTAINED'
  | 'CONTAINMENT_ACTIVATED'
  | 'CONTAINMENT_CLEARED';

export type JarvisOperationEvent = {
  id: string;
  seq: number;
  type: JarvisOperationEventType;
  at: string;
  level: 'info' | 'warn' | 'error';
  summary: string;
  payload: Record<string, unknown>;
  taskId?: string;
  turnId?: string;
  visualState?: string;
  progress?: { current: number; total: number; unit?: string };
  simulated?: boolean;
  errorCode?: string;
};

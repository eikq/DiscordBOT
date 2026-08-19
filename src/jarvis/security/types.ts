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
  | 'ERROR';

export type JarvisOperationEvent = {
  type: JarvisOperationEventType;
  at: string;
  level: 'info' | 'warn' | 'error';
  summary: string;
  payload: Record<string, unknown>;
};

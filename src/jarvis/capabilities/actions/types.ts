import type { CapabilitySideEffect } from '../types';
import type { ActionPreflight } from '../../safety/types';

export type ActionRisk = 'READ_ONLY' | 'LOW_RISK_ACTION' | 'CONFIRM_REQUIRED' | 'BLOCKED';
export type PermissionVerdict = 'allow' | 'confirm' | 'deny';
export type ActionSource = 'text' | 'voice' | 'ui' | 'system';

export type ActionExecutionStatus =
  | 'planned'
  | 'completed'
  | 'denied'
  | 'failed'
  | 'confirmation_required'
  | 'unavailable';

export type PermissionDecision = {
  decision: PermissionVerdict;
  reasonCode: string;
  userMessage: string;
  capabilityId: string;
  proposalId: string;
  risk: ActionRisk;
};

export type ActionProposal = {
  proposalId: string;
  capabilityId: string;
  displayName: string;
  summary: string;
  target: string;
  normalizedArguments: Record<string, unknown>;
  argumentsHash: string;
  risk: ActionRisk;
  sideEffectClass: CapabilitySideEffect;
  source: ActionSource;
  createdAt: string;
  expiresAt: string;
  permissionDecision?: PermissionDecision;
  provenance: {
    requestId?: string;
    sessionId?: string;
    source: ActionSource;
  };
  preflight?: ActionPreflight;
};

export type PendingConfirmation = {
  proposalId: string;
  token: string;
  capabilityId: string;
  displayName: string;
  summary: string;
  target: string;
  risk: ActionRisk;
  reason: string;
  expiresAt: string;
  preflight?: ActionPreflight;
};

export type DesktopLaunchStatus = 'started' | 'failed' | 'unavailable';

export type DesktopLaunchResult = {
  status: DesktopLaunchStatus;
  errorCode?: string;
  message?: string;
};

export type ApplicationRecord = {
  id: string;
  displayName: string;
  executable?: string;
  installed: boolean;
  allowedArgs: string[];
};

export type ProjectRecord = {
  id: string;
  displayName: string;
  path: string;
  installed: boolean;
  openWith: 'explorer';
};

export type DesktopAllowlists = {
  applications: ApplicationRecord[];
  projects: ProjectRecord[];
  trustedOrigins: string[];
  trustedPathPrefixes: string[];
  explorerExecutable?: string;
  workspaceRoot: string;
};

export type ActionAuditEvent = {
  v: 1;
  at: string;
  proposalId: string;
  capabilityId: string;
  risk: ActionRisk;
  decision: string;
  result: string;
  source: ActionSource;
  reasonCode?: string;
  targetClass?: string;
};

export type CapabilityCall = {
  id: string;
  input?: Record<string, unknown>;
  confirmation?: {
    proposalId: string;
    token: string;
  };
};

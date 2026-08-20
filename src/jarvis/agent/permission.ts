import { hashToken } from '../capabilities/actions/hash';
import type { PlanStep, PermissionGrantInput, PermissionLease, WorkTask } from './types';

export class PermissionDeniedError extends Error {
  public readonly reasonCode: string;

  constructor(message: string, reasonCode: string) {
    super(message);
    this.reasonCode = reasonCode;
  }
}

export function waitingPermissionStep(task: WorkTask, stepId?: string): PlanStep | undefined {
  return task.plan.find(step => (
    step.status === 'waiting_permission'
    && (!stepId || step.id === stepId)
  ));
}

export function validatePermissionGrant(
  task: WorkTask,
  step: PlanStep,
  grant: PermissionGrantInput,
  now = Date.now(),
): { lease: PermissionLease; token?: string } {
  if (grant.actor !== 'owner') {
    throw new PermissionDeniedError(
      grant.actor === 'jarvis' || grant.actor === 'system'
        ? 'Jarvis cannot approve its own permission request.'
        : 'Untrusted content cannot grant permission.',
      grant.actor === 'jarvis' || grant.actor === 'system' ? 'SELF_APPROVAL_DENIED' : 'UNTRUSTED_ACTOR',
    );
  }
  if (step.deniedPermission) {
    throw new PermissionDeniedError('This permission request was already denied.', 'PROPOSAL_DENIED');
  }
  if (step.permissionLease?.used) {
    throw new PermissionDeniedError('That permission lease was already used.', 'CONFIRMATION_REUSED');
  }
  const capability = grant.capability || step.pendingConfirmation?.capability || step.capability || step.id;
  if (grant.capability && step.capability && grant.capability !== step.capability) {
    throw new PermissionDeniedError('Permission is bound to a different capability.', 'PERMISSION_SCOPE');
  }
  if (grant.taskId && grant.taskId !== task.id) {
    throw new PermissionDeniedError('Permission is bound to a different task.', 'PERMISSION_SCOPE');
  }
  if (grant.stepId && grant.stepId !== step.id) {
    throw new PermissionDeniedError('Permission is bound to a different step.', 'PERMISSION_SCOPE');
  }
  const proposalId = grant.proposalId || step.pendingConfirmation?.proposalId;
  if (step.pendingConfirmation?.proposalId && proposalId && proposalId !== step.pendingConfirmation.proposalId) {
    throw new PermissionDeniedError('Permission is bound to a different proposal.', 'PERMISSION_SCOPE');
  }
  const expiresAt = grant.expiresAt || step.pendingConfirmation?.expiresAt;
  if (expiresAt && Date.parse(expiresAt) < now) {
    throw new PermissionDeniedError('That permission lease has expired.', 'CONFIRMATION_EXPIRED');
  }
  if (step.pendingConfirmation && !grant.token) {
    throw new PermissionDeniedError(
      'Owner confirmation token is required to resume this gated step.',
      'PERMISSION_REQUIRED',
    );
  }
  const lease: PermissionLease = {
    taskId: task.id,
    stepId: step.id,
    capability,
    scope: grant.scope ?? step.input ?? {},
    risk: grant.risk || step.pendingConfirmation?.risk || step.riskLevel,
    proposalId,
    expiresAt,
    used: false,
    denied: false,
    grantedAt: new Date(now).toISOString(),
    tokenHash: grant.token ? hashToken(grant.token) : undefined,
  };
  return { lease, token: grant.token };
}

export function markLeaseUsed(step: PlanStep): void {
  if (!step.permissionLease) return;
  step.permissionLease = { ...step.permissionLease, used: true };
  delete step.permissionLease.token;
}

export function denyPermissionStep(step: PlanStep): PlanStep {
  return {
    ...step,
    status: 'blocked',
    deniedPermission: true,
    permissionLease: step.permissionLease
      ? { ...step.permissionLease, denied: true, used: true, token: undefined }
      : {
          taskId: '',
          stepId: step.id,
          capability: step.capability || step.id,
          scope: {},
          risk: step.riskLevel,
          used: true,
          denied: true,
        },
    resultSummary: 'Owner denied permission. Denial stays denied.',
    errorCode: 'PERMISSION_REQUIRED',
  };
}

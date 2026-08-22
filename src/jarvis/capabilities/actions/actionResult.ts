import type { ActionResult } from '../../core/types';
import type { CapabilityResult } from '../types';
import type { ActionExecutionStatus, ActionRisk, PendingConfirmation } from './types';

export function capabilityResultToActionResult(result: CapabilityResult): ActionResult {
  const structured = result.structured ?? {};
  const status = actionStatusOf(result);
  return Object.freeze({
    name: result.capabilityId,
    status,
    detail: typeof structured.detail === 'string' ? structured.detail : result.error,
    proposalId: typeof structured.proposalId === 'string' ? structured.proposalId : undefined,
    capabilityId: result.capabilityId,
    summary: result.content || (typeof structured.summary === 'string' ? structured.summary : undefined),
    risk: isActionRisk(structured.risk) ? structured.risk : undefined,
    errorCode: typeof structured.reasonCode === 'string'
      ? structured.reasonCode
      : (typeof structured.errorCode === 'string' ? structured.errorCode : undefined),
    startedAt: typeof structured.startedAt === 'string' ? structured.startedAt : undefined,
    completedAt: typeof structured.completedAt === 'string' ? structured.completedAt : undefined,
    structured,
  });
}

export function pendingConfirmationOf(result: CapabilityResult): PendingConfirmation | undefined {
  const structured = result.structured ?? {};
  if (structured.status !== 'confirmation_required') return undefined;
  if (typeof structured.proposalId !== 'string' || typeof structured.confirmToken !== 'string') return undefined;
  return {
    proposalId: structured.proposalId,
    token: structured.confirmToken,
    capabilityId: result.capabilityId,
    displayName: typeof structured.displayName === 'string' ? structured.displayName : result.capabilityId,
    summary: typeof structured.summary === 'string' ? structured.summary : result.content,
    target: typeof structured.target === 'string' ? structured.target : '',
    risk: isActionRisk(structured.risk) ? structured.risk : 'CONFIRM_REQUIRED',
    reason: typeof structured.reason === 'string' ? structured.reason : 'Confirmation required.',
    expiresAt: typeof structured.expiresAt === 'string' ? structured.expiresAt : '',
    ...(isRecord(structured.permissionProposal)
      ? { permissionProposal: structured.permissionProposal as PendingConfirmation['permissionProposal'] }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function freezeActionResults(results: ActionResult[]): ActionResult[] {
  return results.map(item => ({ ...item }));
}

function actionStatusOf(result: CapabilityResult): ActionExecutionStatus {
  const structuredStatus = result.structured?.status;
  if (structuredStatus === 'confirmation_required') return 'confirmation_required';
  if (structuredStatus === 'denied') return 'denied';
  if (structuredStatus === 'unavailable') return 'unavailable';
  if (structuredStatus === 'completed' || result.status === 'ok') return 'completed';
  if (result.status === 'unavailable' || result.status === 'timeout') return 'unavailable';
  if (result.status === 'rejected') return 'denied';
  return 'failed';
}

function isActionRisk(value: unknown): value is ActionRisk {
  return value === 'READ_ONLY'
    || value === 'LOW_RISK_ACTION'
    || value === 'CONFIRM_REQUIRED'
    || value === 'BLOCKED';
}

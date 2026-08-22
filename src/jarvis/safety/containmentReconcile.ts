/**
 * Read-only containment reconciliation. Clearing remains an owner act.
 */

import type { ContainmentIncident } from './failureContainment';

export const CONTAINMENT_RESOLUTIONS = [
  'KEEP_CONTAINED',
  'CLEAR_THIS_SCOPE',
  'ACCEPT_CURRENT_STATE',
  'REVERIFY',
] as const;

export type ContainmentResolutionKind = (typeof CONTAINMENT_RESOLUTIONS)[number];

export type ContainmentObservedState =
  | 'NO_CHANGE'
  | 'COMPLETED_UNVERIFIED'
  | 'PARTIAL'
  | 'UNDETERMINED';

export type ContainmentEvidence = {
  windowFound?: boolean;
  boundsOverlapIntended?: boolean;
  matchesRequestedDisplay?: boolean;
  mutationObserved?: boolean;
};

export type ContainmentReconcileResult = {
  incidentId: string;
  capabilityId: string;
  observedState: ContainmentObservedState;
  proposedResolution: ContainmentResolutionKind;
  canProposeClear: boolean;
  message: string;
};

const EXPECTED_NO_MUTATION = new Set([
  'DISPLAY_AMBIGUOUS',
  'DISPLAY_NOT_FOUND',
  'DISPLAY_TOPOLOGY_UNKNOWN',
  'DISPLAY_SELECTOR_MISSING',
  'WINDOW_NOT_FOUND',
  'PROCESS_NOT_ALLOWLISTED',
  'UNKNOWN_APPLICATION',
  'PLACE_REQUIRES_MANAGED_WINDOW',
  'FOCUS_REQUIRES_MANAGED_WINDOW',
  'WINDOW_IDENTITY_AMBIGUOUS',
]);

export function isExpectedNoMutationOutcome(result: {
  status?: string;
  error?: string;
  structured?: { reasonCode?: unknown };
}): boolean {
  if (result.status !== 'unavailable' && result.status !== 'error') return false;
  const code = String(result.error || result.structured?.reasonCode || '');
  return EXPECTED_NO_MUTATION.has(code);
}

export function reconcileContainment(
  incident: ContainmentIncident,
  evidence: ContainmentEvidence = {},
): ContainmentReconcileResult {
  const observedState = classifyObservedState(incident, evidence);
  const canProposeClear = incident.active
    && (observedState === 'NO_CHANGE' || observedState === 'COMPLETED_UNVERIFIED')
    && evidence.mutationObserved !== true
    && incident.reasonCode !== 'CONTAINMENT_STATE_CORRUPT';
  const proposedResolution: ContainmentResolutionKind = !incident.active
    ? 'ACCEPT_CURRENT_STATE'
    : canProposeClear
      ? (observedState === 'COMPLETED_UNVERIFIED' ? 'ACCEPT_CURRENT_STATE' : 'CLEAR_THIS_SCOPE')
      : observedState === 'PARTIAL'
        ? 'KEEP_CONTAINED'
        : 'REVERIFY';
  return {
    incidentId: incident.id,
    capabilityId: incident.capabilityId,
    observedState,
    proposedResolution,
    canProposeClear,
    message: messageFor(incident, observedState, canProposeClear),
  };
}

export function evidenceFromWindowInspection(input: {
  windowFound: boolean;
  straddling?: boolean;
  fullyOnOneDisplay?: boolean;
  intendedDisplayId?: string;
  currentDisplayId?: string;
}): ContainmentEvidence {
  const evidence: ContainmentEvidence = { windowFound: input.windowFound };
  if (!input.windowFound) {
    evidence.mutationObserved = false;
    return evidence;
  }
  if (input.intendedDisplayId && input.currentDisplayId) {
    evidence.matchesRequestedDisplay = input.intendedDisplayId === input.currentDisplayId;
    evidence.boundsOverlapIntended = input.intendedDisplayId === input.currentDisplayId;
  }
  if (input.straddling) {
    evidence.mutationObserved = true;
    return evidence;
  }
  if (input.fullyOnOneDisplay) {
    evidence.mutationObserved = false;
  }
  return evidence;
}

export function classifyObservedState(
  incident: ContainmentIncident,
  evidence: ContainmentEvidence,
): ContainmentObservedState {
  if (evidence.mutationObserved === true && evidence.matchesRequestedDisplay !== true && evidence.boundsOverlapIntended !== true) {
    return 'PARTIAL';
  }
  if (evidence.matchesRequestedDisplay === true || evidence.boundsOverlapIntended === true) {
    return 'COMPLETED_UNVERIFIED';
  }
  if (evidence.windowFound === false || evidence.mutationObserved === false) {
    return 'NO_CHANGE';
  }
  if (EXPECTED_NO_MUTATION.has(incident.actualObservedResult) || /DISPLAY_AMBIGUOUS|WINDOW_NOT_FOUND/u.test(incident.actualObservedResult)) {
    return evidence.windowFound === undefined ? 'UNDETERMINED' : 'NO_CHANGE';
  }
  return 'UNDETERMINED';
}

function messageFor(
  incident: ContainmentIncident,
  observedState: ContainmentObservedState,
  canProposeClear: boolean,
): string {
  if (!incident.active) return 'That containment is already cleared.';
  if (canProposeClear && observedState === 'NO_CHANGE') {
    return `I previously failed to verify a window-placement action, so I blocked further placement for that window. Current evidence shows no leftover partial placement. Clear this placement containment?`;
  }
  if (canProposeClear && observedState === 'COMPLETED_UNVERIFIED') {
    return 'The window appears to already be on the intended display. Clear this placement containment?';
  }
  if (observedState === 'PARTIAL') {
    return 'A partial placement may still be in progress. I am keeping this containment until you choose how to recover.';
  }
  return 'I cannot yet prove that placement is safe to resume. I can inspect again, but I will not clear this containment silently.';
}

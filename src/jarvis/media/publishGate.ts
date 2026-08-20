/**
 * Publishing is a mutating capability, separate from artifact production.
 * ARTIFACT READY → OWNER/POLICY → ACTIONGATE → PUBLISH
 * Never auto-publish.
 */

export type PublishDecision = {
  allowed: false;
  reason: string;
  gate: 'ARTIFACT_READY' | 'OWNER_POLICY' | 'ACTIONGATE' | 'PUBLISH';
};

export function neverAutoPublish(): false {
  return false;
}

export function requestPublish(input: {
  artifactReady: boolean;
  ownerApproved: boolean;
  actionGateGranted: boolean;
}): PublishDecision {
  if (!input.artifactReady) {
    return { allowed: false, reason: 'Artifact is not ready.', gate: 'ARTIFACT_READY' };
  }
  if (!input.ownerApproved) {
    return { allowed: false, reason: 'Owner/policy approval required.', gate: 'OWNER_POLICY' };
  }
  if (!input.actionGateGranted) {
    return { allowed: false, reason: 'ActionGate grant required at publish time.', gate: 'ACTIONGATE' };
  }
  return { allowed: false, reason: 'Publish remains owner-gated; auto-publish is denied.', gate: 'PUBLISH' };
}

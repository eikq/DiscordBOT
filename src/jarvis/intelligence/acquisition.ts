import { redactSecrets } from '../security/redaction';

export const CAPABILITY_CANDIDATE_STATES = [
  'DISCOVERED',
  'RESEARCHED',
  'DESIGNED',
  'SANDBOXED',
  'REVIEWED',
  'TESTED',
  'SECURITY_REVIEWED',
  'VERIFIED',
  'OWNER_APPROVAL_REQUIRED',
  'OWNER_APPROVED',
  'INSTALLED',
  'REGISTERED',
  'ENABLED',
  'REJECTED',
] as const;

export type CapabilityCandidateState = (typeof CAPABILITY_CANDIDATE_STATES)[number];
export type CapabilityCandidateActor = 'owner' | 'jarvis' | 'model' | 'system';

export type CapabilityAcquisitionCandidate = {
  id: string;
  capabilityId: string;
  source: string;
  state: CapabilityCandidateState;
  trusted: boolean;
  installed: boolean;
  executable: boolean;
  evidence: string[];
  ownerApproved: boolean;
};

const NEXT: Partial<Record<CapabilityCandidateState, CapabilityCandidateState>> = {
  DISCOVERED: 'RESEARCHED',
  RESEARCHED: 'DESIGNED',
  DESIGNED: 'SANDBOXED',
  SANDBOXED: 'REVIEWED',
  REVIEWED: 'TESTED',
  TESTED: 'SECURITY_REVIEWED',
  SECURITY_REVIEWED: 'VERIFIED',
  VERIFIED: 'OWNER_APPROVAL_REQUIRED',
};

export function discoverCapabilityCandidate(input: {
  id: string;
  capabilityId: string;
  source: string;
}): CapabilityAcquisitionCandidate {
  const source = redactSecrets(input.source);
  return {
    ...input,
    source,
    state: 'DISCOVERED',
    trusted: false,
    installed: false,
    executable: false,
    evidence: [`discovered:${source}`],
    ownerApproved: false,
  };
}

export function advanceCapabilityCandidate(
  candidate: CapabilityAcquisitionCandidate,
  evidence: string,
): CapabilityAcquisitionCandidate {
  const next = NEXT[candidate.state];
  if (!next) throw new Error(`Candidate ${candidate.id} cannot advance automatically from ${candidate.state}.`);
  if (!evidence.trim()) throw new Error('Capability candidate advancement requires evidence.');
  return { ...candidate, state: next, evidence: [...candidate.evidence, redactSecrets(evidence)] };
}

export function approveCapabilityCandidate(
  candidate: CapabilityAcquisitionCandidate,
  actor: CapabilityCandidateActor,
  evidence: string,
): CapabilityAcquisitionCandidate {
  if (actor !== 'owner') throw new Error('Only the owner can approve a capability candidate.');
  if (candidate.state !== 'OWNER_APPROVAL_REQUIRED') throw new Error('Candidate is not ready for owner approval.');
  if (!evidence.trim()) throw new Error('Owner approval provenance is required.');
  return {
    ...candidate,
    state: 'OWNER_APPROVED',
    ownerApproved: true,
    evidence: [...candidate.evidence, redactSecrets(evidence)],
  };
}

export function markCapabilityCandidateRegistered(
  candidate: CapabilityAcquisitionCandidate,
  actor: CapabilityCandidateActor,
  registryEvidence: string,
): CapabilityAcquisitionCandidate {
  if (actor !== 'system') throw new Error('Only the reviewed runtime registration path may mark a candidate registered.');
  if (candidate.state !== 'INSTALLED' || !candidate.installed || !candidate.ownerApproved) {
    throw new Error('Candidate registration requires an owner-approved, evidence-backed installation.');
  }
  if (!registryEvidence.trim()) throw new Error('Registration evidence is required.');
  return {
    ...candidate,
    state: 'REGISTERED',
    trusted: true,
    evidence: [...candidate.evidence, redactSecrets(registryEvidence)],
  };
}

export function markCapabilityCandidateInstalled(
  candidate: CapabilityAcquisitionCandidate,
  actor: CapabilityCandidateActor,
  installationEvidence: string,
): CapabilityAcquisitionCandidate {
  if (actor !== 'system') throw new Error('Only the reviewed installation path may mark a candidate installed.');
  if (candidate.state !== 'OWNER_APPROVED' || !candidate.ownerApproved) {
    throw new Error('Candidate installation requires verified owner approval.');
  }
  if (!installationEvidence.trim()) throw new Error('Installation evidence is required.');
  return {
    ...candidate,
    state: 'INSTALLED',
    installed: true,
    evidence: [...candidate.evidence, redactSecrets(installationEvidence)],
  };
}

export function enableCapabilityCandidate(
  candidate: CapabilityAcquisitionCandidate,
  actor: CapabilityCandidateActor,
  evidence: string,
): CapabilityAcquisitionCandidate {
  if (actor !== 'owner') throw new Error('Only the owner can enable a registered candidate.');
  if (candidate.state !== 'REGISTERED' || !candidate.trusted) throw new Error('Only a registered trusted candidate can be enabled.');
  if (!evidence.trim()) throw new Error('Enable evidence is required.');
  return {
    ...candidate,
    state: 'ENABLED',
    executable: true,
    evidence: [...candidate.evidence, redactSecrets(evidence)],
  };
}

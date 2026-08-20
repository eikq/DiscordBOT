export const SKILL_LIFECYCLE = [
  'CANDIDATE',
  'TESTED',
  'TRUSTED_INSTRUCTION',
  'ACTIVE',
  'DEPRECATED',
  'REJECTED',
  'ROLLED_BACK',
] as const;

export const SKILL_TRUST_STATES = [
  'DRAFT',
  'REVIEW_REQUIRED',
  'TRUSTED',
  'REJECTED',
  'DEPRECATED',
] as const;

/** Procedural skills never collapse these stages. Jarvis cannot jump to TRUST or EXECUTE. */
export const SKILL_AUTHORITY_STAGES = [
  'DISCOVER',
  'INSTALL',
  'REVIEW',
  'TRUST',
  'EXECUTE',
] as const;

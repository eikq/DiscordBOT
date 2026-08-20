export type ExperienceOutcome = 'success' | 'failure' | 'partial' | 'corrected';

export type FailureKnowledgeKind =
  | 'capability_unavailable'
  | 'provider_timeout'
  | 'unsupported_host'
  | 'known_bad_plan'
  | 'owner_denied'
  | 'verification_failed';

export type MemoryKind =
  | 'working'
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'user_model'
  | 'social'
  | 'self_model';

export type ExperienceRecord = {
  id: string;
  createdAt: string;
  kind: MemoryKind;
  goal: string;
  situation: string;
  actions: string[];
  tools: string[];
  result: string;
  outcome: ExperienceOutcome;
  ownerCorrection?: string;
  lessons: string[];
  confidence: number;
  privacyClass: 'public' | 'private' | 'sensitive';
  cause?: string;
  domain?: string;
  significance?: number;
  evidenceRefs?: string[];
  ownerFeedback?: string;
  verified?: boolean;
  failureKind?: FailureKnowledgeKind;
};

export type StructuredReflection = {
  happened: string;
  worked: string;
  failed: string;
  cause: string;
  happenedBefore: boolean;
  reusableLesson: string;
  memoryChange: string;
  skillChange: string;
  needsMoreEvidence: boolean;
};

export type SkillLifecycleStatus =
  | 'CANDIDATE'
  | 'TESTED'
  | 'TRUSTED_INSTRUCTION'
  | 'ACTIVE'
  | 'DEPRECATED'
  | 'REJECTED'
  | 'ROLLED_BACK';

export type SkillTrustStatus =
  | 'DRAFT'
  | 'REVIEW_REQUIRED'
  | 'TRUSTED'
  | 'REJECTED'
  | 'DEPRECATED';

export type ProceduralSkillVersion = {
  id: string;
  skillId: string;
  name: string;
  version: number;
  purpose: string;
  goal: string;
  trigger: string;
  triggerConditions: string[];
  requiredCapabilities: string[];
  prerequisites: string[];
  workflow: string[];
  steps: string[];
  failureModes: string[];
  recovery: string[];
  safetyConstraints: string[];
  securityScope: string;
  verification: string[];
  evidence: string[];
  knownGood: boolean;
  status: SkillLifecycleStatus;
  trustStatus: SkillTrustStatus;
  parentVersion?: number;
  scriptsAllowed: false;
  autoPromote: false;
};

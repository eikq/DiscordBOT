export type ExperienceOutcome = 'success' | 'failure' | 'partial' | 'corrected';

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

export type ProceduralSkillVersion = {
  skillId: string;
  version: number;
  purpose: string;
  trigger: string;
  prerequisites: string[];
  workflow: string[];
  failureModes: string[];
  recovery: string[];
  safetyConstraints: string[];
  verification: string[];
  evidence: string[];
  knownGood: boolean;
};

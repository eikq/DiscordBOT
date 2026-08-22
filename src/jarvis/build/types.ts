export const BUILD_PLAN_STATUSES = [
  'DRAFT',
  'READY_FOR_REVIEW',
  'APPROVED',
  'EXECUTING',
  'WAITING_PERMISSION',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
] as const;

export type BuildPlanStatus = (typeof BUILD_PLAN_STATUSES)[number];

export const BUILD_STAGE_STATUSES = [
  'pending',
  'active',
  'complete',
  'failed',
  'waiting-owner',
] as const;

export type BuildStageStatus = (typeof BUILD_STAGE_STATUSES)[number];

export const VISUAL_WORKFLOW_NODES = [
  'UNDERSTAND',
  'PLAN',
  'REVIEW',
  'PERMISSION',
  'BUILD',
  'TEST',
  'DONE',
] as const;

export type VisualWorkflowNode = (typeof VISUAL_WORKFLOW_NODES)[number];

export type BuildProjectType = 'WEBSITE' | 'SOFTWARE';

export type BuildStage = {
  id: string;
  title: string;
  shortDescription: string;
  status: BuildStageStatus;
  dependencies: string[];
  expectedArtifacts: string[];
  verification: string[];
};

export type BuildPlan = {
  id: string;
  goalId: string;
  sessionId?: string;
  title: string;
  summary: string;
  brief: string;
  slug: string;
  requirements: string[];
  assumptions: string[];
  projectType: BuildProjectType;
  suggestedStack: string;
  stages: BuildStage[];
  permissionsNeeded: string[];
  artifactsExpected: string[];
  acceptanceCriteria: string[];
  risks: string[];
  status: BuildPlanStatus;
  createdAt: number;
  updatedAt: number;
};

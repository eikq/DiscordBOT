import type { JarvisErrorCode } from '../ops/types';

export const WORK_TASK_STATUSES = [
  'RECEIVED',
  'UNDERSTANDING',
  'PLANNING',
  'READY',
  'EXECUTING',
  'OBSERVING',
  'ADAPTING',
  'VERIFYING',
  'COMPLETED',
  'WAITING_PERMISSION',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
  'PAUSED',
  'DEGRADED',
] as const;

export type WorkTaskStatus = (typeof WORK_TASK_STATUSES)[number];

export const PLAN_STEP_KINDS = [
  'understand',
  'retrieve',
  'search',
  'research',
  'plan',
  'permission',
  'apply',
  'test',
  'verify',
  'reflect',
] as const;

export type PlanStepKind = (typeof PLAN_STEP_KINDS)[number];

export const PLAN_STEP_STATUSES = [
  'pending',
  'ready',
  'running',
  'done',
  'failed',
  'cancelled',
  'blocked',
  'waiting_permission',
  'skipped',
  'retrying',
] as const;

export type PlanStepStatus = (typeof PLAN_STEP_STATUSES)[number];

export type PlanStep = {
  id: string;
  title: string;
  kind: PlanStepKind;
  dependencies: string[];
  status: PlanStepStatus;
  capability?: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  verificationMethod: string;
  retryPolicy: { maxAttempts: number; attempted: number };
  input?: Record<string, unknown>;
  resultSummary?: string;
  errorCode?: JarvisErrorCode;
};

export type WorkTaskOutcome = 'success' | 'failure' | 'cancelled' | 'blocked' | 'degraded';

export type WorkTask = {
  id: string;
  objective: string;
  createdAt: string;
  updatedAt: string;
  status: WorkTaskStatus;
  plan: PlanStep[];
  evidence: string[];
  toolResults: Array<{ capability: string; status: string; summary: string }>;
  permissionRequirements: string[];
  retryBudget: number;
  retriesUsed: number;
  errors: Array<{ at: string; code: JarvisErrorCode; message: string; stepId?: string }>;
  rollbackInfo?: string;
  verification?: { passed: boolean; summary: string };
  outcome?: WorkTaskOutcome;
  simulated?: boolean;
  cancelRequested?: boolean;
};

export type WorkStepResult = {
  ok: boolean;
  summary: string;
  status?: PlanStepStatus;
  permissionRequired?: boolean;
  errorCode?: JarvisErrorCode;
  toolResult?: { capability: string; status: string; summary: string };
  evidence?: string[];
  skipped?: boolean;
};

export type WorkStepInvoker = (task: WorkTask, step: PlanStep, signal: AbortSignal) => Promise<WorkStepResult>;

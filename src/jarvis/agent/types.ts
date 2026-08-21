import type { JarvisErrorCode } from '../ops/types';
import type { ActionPreflight, RollbackContract, VerificationRecord, VerificationState } from '../safety/types';
import type { CapabilityCancellationRecord } from '../capabilities/types';
import type { GapResolutionPlan, ObjectiveBlockerCode } from '../intelligence/types';
import type { GoalOutcomeEvidence, GoalResolution } from '../goals/types';

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
  'WAITING_INPUT',
  'WAITING_PERMISSION',
  'BLOCKED',
  'FAILED',
  'CANCELLED',
  'PAUSED',
  'DEGRADED',
  'EXPIRED',
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

export type PermissionLease = {
  taskId: string;
  stepId: string;
  capability: string;
  scope: Record<string, unknown>;
  risk: string;
  proposalId?: string;
  expiresAt?: string;
  grantedAt?: string;
  used: boolean;
  denied: boolean;
  tokenHash?: string;
  token?: string;
};

export type PendingStepConfirmation = {
  proposalId: string;
  capability: string;
  risk: string;
  expiresAt?: string;
  summary?: string;
  preflight?: ActionPreflight;
};

export type PermissionGrantInput = {
  actor?: 'owner' | 'system' | 'jarvis';
  taskId?: string;
  stepId?: string;
  capability?: string;
  scope?: Record<string, unknown>;
  risk?: string;
  proposalId?: string;
  token?: string;
  expiresAt?: string;
};

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
  pendingConfirmation?: PendingStepConfirmation;
  permissionLease?: PermissionLease;
  deniedPermission?: boolean;
  preflight?: ActionPreflight;
  verification?: VerificationRecord;
  rollback?: RollbackContract;
  cancellation?: CapabilityCancellationRecord;
  inputAdapter?: {
    id: string;
    compatibility: 'ADAPTER_COMPATIBLE';
    evidence: string[];
  };
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
  rollback?: RollbackContract;
  verification?: {
    passed: boolean;
    summary: string;
    state: VerificationState;
    evidence: string[];
    failedChecks: string[];
  };
  outcome?: WorkTaskOutcome;
  simulated?: boolean;
  cancelRequested?: boolean;
  cancellation?: CapabilityCancellationRecord;
  gapResolution?: GapResolutionPlan;
  blockers?: Array<{
    capabilityId: string;
    blocker: ObjectiveBlockerCode;
    reason: string;
  }>;
  goalPursuit?: {
    attempted: number;
    maximum: number;
  };
  goalResolution?: GoalResolution;
  goalOutcome?: GoalOutcomeEvidence;
  waitingInput?: {
    pendingGoalId: string;
    question: string;
    missingFields: string[];
    expiresAt: string;
    state: 'WAITING_OWNER_INPUT' | 'READY_TO_RESUME' | 'EXPIRED' | 'CANCELLED';
  };
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
  pendingConfirmation?: PendingStepConfirmation;
  confirmToken?: string;
  preflight?: ActionPreflight;
  verification?: VerificationRecord;
  rollback?: RollbackContract;
  cancellation?: CapabilityCancellationRecord;
  gapResolution?: GapResolutionPlan;
};

export type SynthesizedOutcome =
  | 'SUCCESS'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'FAILED'
  | 'CANCELLED'
  | 'DEGRADED';

export type SynthesizedTaskResponse = {
  outcome: SynthesizedOutcome;
  text: string;
  evidence: string[];
  observations: string[];
  verification?: string;
};

export type WorkStepInvoker = (task: WorkTask, step: PlanStep, signal: AbortSignal) => Promise<WorkStepResult>;

export type WorkGapResolver = (
  task: WorkTask,
  step: PlanStep,
  result: WorkStepResult,
  attempted: number,
  maximum: number,
) => Promise<GapResolutionPlan | undefined>;

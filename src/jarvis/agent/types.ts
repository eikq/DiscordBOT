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
};

export type WorkTaskOutcome = 'success' | 'failure' | 'cancelled' | 'blocked' | 'degraded';

export type WorkTask = {
  id: string;
  objective: string;
  createdAt: string;
  updatedAt: string;
  status: WorkTaskStatus;
  requestId?: string;
  sessionId?: string;
  turnId?: string;
  plan: PlanStep[];
  evidence: string[];
  toolResults: Array<{
    capability: string;
    status: string;
    summary: string;
    risk?: string;
    facts?: {
      systemSnapshot?: {
        summary?: string;
        parts?: string[];
        cpu?: { usagePct: number; cores: number };
        ram?: { usedPct: number; freeMb?: number; totalMb?: number };
        disk?: { usedPct?: number; freeGb?: number; totalGb?: number };
        gpu?: { name: string; utilizationPct?: number; vramUsedMb?: number; vramTotalMb?: number };
      };
      displays?: {
        count: number;
        ids: string[];
        names?: string[];
        currentName?: string;
        currentId?: string;
        hostKind?: string;
        reason?: string;
      };
    };
  }>;
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
  toolResult?: {
    capability: string;
    status: string;
    summary: string;
    risk?: string;
    facts?: WorkTask['toolResults'][number]['facts'];
  };
  evidence?: string[];
  skipped?: boolean;
  pendingConfirmation?: PendingStepConfirmation;
  confirmToken?: string;
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

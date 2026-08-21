import type { GoalMaturity, GoalResolution, GoalScope } from './types';

export const PENDING_GOAL_STATES = [
  'WAITING_OWNER_INPUT',
  'READY_TO_RESUME',
  'RESUMING',
  'RESOLVED',
  'EXPIRED',
  'CANCELLED',
  'INVALIDATED',
] as const;

export type PendingGoalState = (typeof PENDING_GOAL_STATES)[number];

export type PendingGoalRecord = {
  pendingGoalId: string;
  goalId: string;
  goalVersion: number;
  sessionId: string;
  originalOwnerIntent: string;
  validatedInputs: Record<string, unknown>;
  missingFields: string[];
  selectedRouteId?: string;
  adapterId?: string;
  scope: GoalScope;
  maturity: GoalMaturity;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  state: PendingGoalState;
  evidence: string[];
  revision: number;
  workTaskId?: string;
  continuationReceiptHash?: string;
  continuationReceipts?: string[];
  resolvedGoal?: GoalResolution;
};

export type PendingGoalContinuationStatus =
  | 'NO_PENDING_GOAL'
  | 'NEEDS_DISAMBIGUATION'
  | 'STILL_WAITING'
  | 'READY_TO_RESUME'
  | 'ALREADY_RESUMING'
  | 'ALREADY_RESOLVED'
  | 'BLOCKED'
  | 'GOAL_DRIFT'
  | 'REJECTED'
  | 'CANCELLED'
  | 'EXPIRED';

export type PendingGoalContinuation = {
  status: PendingGoalContinuationStatus;
  pendingGoal?: PendingGoalRecord;
  resolution?: GoalResolution;
  question?: string;
  reason: string;
  changedFields: string[];
  revision: boolean;
  gapResolution?: import('../intelligence/types').GapResolutionPlan;
  candidates?: Array<{ pendingGoalId: string; goalId: string; question: string; expiresAt: string }>;
};

export type ContinuePendingGoalInput = {
  sessionId: string;
  ownerReply: string;
  pendingGoalId?: string;
  idempotencyKey?: string;
  explicitSelection?: boolean;
};

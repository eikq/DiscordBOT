import type { BuildPlan, VisualWorkflowNode } from '../../build/types';

export type PresenceBuildNodeState = 'pending' | 'active' | 'complete' | 'failed' | 'waiting-owner';

export type PresenceBuildNode = {
  id: VisualWorkflowNode;
  label: string;
  state: PresenceBuildNodeState;
};

export type PresenceBuildSurface = {
  title: string;
  artifact?: string;
  tests?: string;
  evidence: string[];
  nodes: PresenceBuildNode[];
};

export type PresenceHistoryItem = {
  id: string;
  role: 'OWNER' | 'JARVIS';
  text: string;
  at: number;
  status?: string;
  goalId?: string;
  planId?: string;
};

const NODES: Array<{ id: VisualWorkflowNode; label: string }> = [
  { id: 'UNDERSTAND', label: 'Understand' },
  { id: 'PLAN', label: 'Plan' },
  { id: 'REVIEW', label: 'Review' },
  { id: 'PERMISSION', label: 'Permission' },
  { id: 'BUILD', label: 'Build' },
  { id: 'TEST', label: 'Test' },
  { id: 'DONE', label: 'Done' },
];

const EVENT_TO_NODE: Record<string, VisualWorkflowNode> = {
  TASK_RECEIVED: 'UNDERSTAND',
  UNDERSTANDING: 'UNDERSTAND',
  PLANNING: 'PLAN',
  PLAN_UPDATED: 'PLAN',
  PLAN_CREATED: 'REVIEW',
  PLAN_APPROVED: 'REVIEW',
  PERMISSION_REQUESTED: 'PERMISSION',
  PERMISSION_GRANTED: 'BUILD',
  PLAN_STAGE_STARTED: 'BUILD',
  ARTIFACT_CREATED: 'BUILD',
  ARTIFACT_UPDATED: 'BUILD',
  VERIFY_STARTED: 'TEST',
  VERIFY_RESULT: 'TEST',
  PLAN_STAGE_COMPLETED: 'DONE',
  PLAN_STAGE_FAILED: 'BUILD',
};

const PLAN_STATUS_TO_NODE: Record<string, VisualWorkflowNode> = {
  DRAFT: 'PLAN',
  READY_FOR_REVIEW: 'REVIEW',
  APPROVED: 'PERMISSION',
  WAITING_PERMISSION: 'PERMISSION',
  EXECUTING: 'BUILD',
  VERIFYING: 'TEST',
  COMPLETED: 'DONE',
  FAILED: 'BUILD',
};

export function isBuildOperationType(type: string): boolean {
  return Boolean(EVENT_TO_NODE[type]) || type === 'MEMORY_UPDATED' || type === 'MODEL_STATUS_CHANGED';
}

export function buildSurfaceFromEvents(
  events: Array<{ type?: string; summary?: string; payload?: Record<string, unknown> }>,
): PresenceBuildSurface | null {
  const relevant = events.filter(item => item.type && EVENT_TO_NODE[item.type]);
  if (!relevant.length) return null;
  const latest = relevant[relevant.length - 1]!;
  return surfaceFor({
    title: String(latest.payload?.title || latest.payload?.slug || 'Build'),
    slug: typeof latest.payload?.slug === 'string' ? latest.payload.slug : undefined,
    evidence: relevant.map(item => String(item.summary || item.type)).slice(-6),
    active: EVENT_TO_NODE[latest.type!] || 'PLAN',
    failed: latest.type === 'PLAN_STAGE_FAILED',
    done: latest.type === 'PLAN_STAGE_COMPLETED',
  });
}

export function buildSurfaceFromPlan(plan?: Pick<BuildPlan, 'title' | 'slug' | 'status' | 'summary'> | null): PresenceBuildSurface | null {
  if (!plan) return null;
  return surfaceFor({
    title: plan.title,
    slug: plan.slug,
    evidence: [plan.summary || plan.status],
    active: PLAN_STATUS_TO_NODE[plan.status] || 'REVIEW',
    failed: plan.status === 'FAILED',
    done: plan.status === 'COMPLETED',
  });
}

export function mergePresenceBuildSurface(
  events: Array<{ type?: string; summary?: string; payload?: Record<string, unknown> }>,
  plans: Array<Pick<BuildPlan, 'title' | 'slug' | 'status' | 'summary' | 'updatedAt'>> = [],
): PresenceBuildSurface | null {
  return buildSurfaceFromEvents(events) || buildSurfaceFromPlan(plans[0]);
}

function surfaceFor(input: {
  title: string;
  slug?: string;
  evidence: string[];
  active: VisualWorkflowNode;
  failed: boolean;
  done: boolean;
}): PresenceBuildSurface {
  const nodes = NODES.map(node => {
    const order = NODES.findIndex(item => item.id === node.id);
    const activeOrder = NODES.findIndex(item => item.id === input.active);
    let state: PresenceBuildNodeState = 'pending';
    if (input.done || order < activeOrder) state = 'complete';
    else if (order === activeOrder) {
      state = input.failed
        ? 'failed'
        : node.id === 'REVIEW' || node.id === 'PERMISSION'
          ? 'waiting-owner'
          : 'active';
    }
    return { ...node, state };
  });
  return {
    title: input.title,
    artifact: input.slug ? `data/jarvis/builds/${input.slug}` : undefined,
    evidence: input.evidence,
    nodes,
  };
}

export function historyItemsFromTurns(turns: Array<{
  id: string;
  role: string;
  visibleText: string;
  timestamp: number;
  status?: string;
  goalId?: string;
  planId?: string;
}>): PresenceHistoryItem[] {
  return turns
    .filter(item => item.role === 'OWNER' || item.role === 'JARVIS')
    .filter(item => hidesReasoning(item.visibleText))
    .map(item => ({
      id: item.id,
      role: item.role as 'OWNER' | 'JARVIS',
      text: item.visibleText,
      at: item.timestamp,
      status: item.status,
      goalId: item.goalId,
      planId: item.planId,
    }));
}

export function hidesReasoning(text: string): boolean {
  return !/<think\b|reasoning_content/iu.test(text);
}

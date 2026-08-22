import type { VisualWorkflowNode } from '../../build/types';

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
  PLAN_CREATED: 'PLAN',
  PLAN_UPDATED: 'PLAN',
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

export function isBuildOperationType(type: string): boolean {
  return Boolean(EVENT_TO_NODE[type]) || type === 'MEMORY_UPDATED' || type === 'MODEL_STATUS_CHANGED';
}

export function buildSurfaceFromEvents(
  events: Array<{ type?: string; summary?: string; payload?: Record<string, unknown> }>,
): PresenceBuildSurface | null {
  const relevant = events.filter(item => item.type && EVENT_TO_NODE[item.type]);
  if (!relevant.length) return null;
  const latest = relevant[relevant.length - 1]!;
  const title = String(latest.payload?.title || latest.payload?.slug || 'Build');
  const artifact = typeof latest.payload?.slug === 'string' ? `data/jarvis/builds/${latest.payload.slug}` : undefined;
  const evidence = relevant.map(item => String(item.summary || item.type)).slice(-6);
  const active = EVENT_TO_NODE[latest.type!] || 'PLAN';
  const failed = latest.type === 'PLAN_STAGE_FAILED';
  const done = latest.type === 'PLAN_STAGE_COMPLETED';
  const nodes = NODES.map(node => {
    const order = NODES.findIndex(item => item.id === node.id);
    const activeOrder = NODES.findIndex(item => item.id === active);
    let state: PresenceBuildNodeState = 'pending';
    if (done || order < activeOrder) state = 'complete';
    else if (order === activeOrder) state = failed ? 'failed' : node.id === 'REVIEW' || node.id === 'PERMISSION' ? 'waiting-owner' : 'active';
    return { ...node, state };
  });
  return { title, artifact, evidence, nodes };
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

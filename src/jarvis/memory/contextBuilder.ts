import type { ConversationTurnRecord } from '../../bot/memory/jarvis/conversationStore';
import type { CompactMemoryItem } from './service';
import type { BuildPlan } from '../build/types';
import type { PermissionProposal } from '../security/permissionProposal';

export const CONTEXT_DYNAMIC_BUDGET_TOKENS = 24_000;
export const CONTEXT_RECENT_TURN_LIMIT = 24;

export type ContextBuilderInput = {
  ownerRequest: string;
  recentTurns?: ConversationTurnRecord[];
  sessionSummary?: string;
  activeGoal?: { id: string; name?: string; status?: string };
  memories?: CompactMemoryItem[];
  plan?: BuildPlan | null;
  pendingPermission?: PermissionProposal | null;
  runtime?: { model?: string; health?: string };
  projectMemory?: string[];
};

export type BuiltContext = {
  promptBlock: string;
  tokenEstimate: number;
  included: string[];
};

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function buildJarvisContext(input: ContextBuilderInput): BuiltContext {
  const included: string[] = [];
  const sections: string[] = [];
  const budget = CONTEXT_DYNAMIC_BUDGET_TOKENS;

  const push = (label: string, body: string) => {
    if (!body.trim()) return;
    const next = estimateTokens([...sections, body].join('\n\n'));
    if (next > budget) return;
    sections.push(body.trim());
    included.push(label);
  };

  push('request', `Current OWNER request:\n${input.ownerRequest.slice(0, 8_000)}`);
  if (input.sessionSummary) push('summary', `Session summary:\n${input.sessionSummary.slice(0, 4_000)}`);
  if (input.activeGoal) {
    push('goal', `Active goal: ${input.activeGoal.id}${input.activeGoal.name ? ` (${input.activeGoal.name})` : ''}${input.activeGoal.status ? ` [${input.activeGoal.status}]` : ''}`);
  }
  if (input.plan) {
    push('plan', [
      `Active plan ${input.plan.id} status=${input.plan.status}`,
      `Title: ${input.plan.title}`,
      `Stack: ${input.plan.suggestedStack}`,
      `Stages: ${input.plan.stages.map(stage => `${stage.id}:${stage.status}`).join(', ')}`,
    ].join('\n'));
  }
  if (input.pendingPermission) {
    push('permission', `Pending permission: ${input.pendingPermission.summary} scope=${input.pendingPermission.scope} duration=${input.pendingPermission.duration}`);
  }
  const recent = (input.recentTurns || [])
    .filter(turn => turn.status === 'completed')
    .slice(-CONTEXT_RECENT_TURN_LIMIT)
    .map(turn => `${turn.role}: ${turn.visibleText.slice(0, 2_000)}`)
    .join('\n');
  if (recent) push('turns', `Recent visible turns:\n${recent}`);
  const memories = (input.memories || [])
    .filter(item => item.status === 'active')
    .slice(0, 8)
    .map(item => `- ${item.factKey || item.canonicalId}: ${item.text.slice(0, 180)}`)
    .join('\n');
  if (memories) push('memory', `Relevant owner/semantic memory:\n${memories}`);
  if (input.projectMemory?.length) push('project', `Project memory:\n${input.projectMemory.slice(0, 6).join('\n')}`);
  if (input.runtime?.health && input.runtime.health !== 'MODEL_READY') {
    push('runtime', `Model health: ${input.runtime.health}`);
  }

  const promptBlock = sections.join('\n\n');
  return {
    promptBlock,
    tokenEstimate: estimateTokens(promptBlock),
    included,
  };
}

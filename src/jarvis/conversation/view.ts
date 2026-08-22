import type { ConversationDebugView, ConversationState, ConversationView, DiscourseAct, OfferedOption } from './types';
import { activeProject } from './referents';

export function conversationView(state: ConversationState): ConversationView {
  const project = activeProject(state);
  const remembering = [
    ...state.remembered.slice(-4),
    ...state.constraints.slice(-3).map(item => `don't: ${item}`),
  ].slice(0, 6);
  return {
    ...(project ? { project: project.label } : {}),
    ...(state.activeGoalId ? { goal: state.activeGoalId } : {}),
    ...(currentTask(state) ? { current: currentTask(state) } : {}),
    ...(sanitizedRecent(state.recentOperation?.summary) ? { recent: sanitizedRecent(state.recentOperation?.summary) } : {}),
    ...(nextHint(state) ? { next: nextHint(state) } : {}),
    ...(permissionLine(state) ? { permission: permissionLine(state) } : {}),
    remembering,
  };
}

export function isOperationalNoise(summary: string | undefined): boolean {
  if (!summary) return false;
  return /Blocked for|MISSING_CAPABILITY|unbound\.apply|Safest next path|Current blocker|Those software arguments are not allowed|ต้องขอสิทธิ์/i.test(summary);
}

export function isPermissionPrompt(summary: string | undefined): boolean {
  if (!summary) return false;
  return /ต้องขอสิทธิ์|กดอนุญาต|Waiting THIS_GOAL|รออนุญาต/i.test(summary);
}

export function compactRecent(summary: string): string {
  const clean = summary.replace(/\s+/g, ' ').trim();
  return clean.length > 88 ? `${clean.slice(0, 85)}…` : clean;
}

export function sanitizedRecent(summary: string | undefined): string {
  if (!summary || isOperationalNoise(summary)) return '';
  return compactRecent(summary);
}

function currentTask(state: ConversationState): string | undefined {
  if (state.pendingPermission) return 'Waiting for permission';
  if (state.pendingPlanReview) return 'Reviewing plan';
  if (state.queue.find(item => item.status === 'running')) {
    return state.queue.find(item => item.status === 'running')?.text;
  }
  if (state.recentOperation) return labelAct(state.lastDiscourse) || state.recentOperation.kind;
  return state.lastDiscourse ? labelAct(state.lastDiscourse) : undefined;
}

function nextHint(state: ConversationState): string | undefined {
  const pending = state.queue.filter(item => item.status === 'pending').slice(0, 3).map(item => item.text);
  if (pending.length) return pending.join(' → ');
  if (state.pendingConditional) return `${state.pendingConditional.ifKind} → ${state.pendingConditional.thenAct.toLowerCase()}`;
  if (state.recentVerification?.kind === 'test' && state.recentVerification.ok) return 'Build → Preview';
  if (state.recentVerification?.kind === 'build' && state.recentVerification.ok) return 'Preview';
  return undefined;
}

function permissionLine(state: ConversationState): string | undefined {
  if (state.pendingPermission) return 'Waiting THIS_GOAL grant';
  if (state.activeProjectSlug) return 'Project write / test / build';
  return undefined;
}

function labelAct(act: DiscourseAct | undefined): string | undefined {
  if (!act) return undefined;
  const labels: Partial<Record<DiscourseAct, string>> = {
    TEST: 'Run tests',
    BUILD: 'Build',
    PREVIEW: 'Preview',
    MODIFY_PROJECT: 'Edit project',
    CONTINUE: 'Continue current work',
    RESEARCH: 'Research',
    PLAN_REQUEST: 'Planning',
  };
  return labels[act];
}

export function optionsFromReply(text: string): OfferedOption[] {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const numbered = lines.flatMap(line => {
    const match = line.match(/^(?:[-*]|(\d+)[.)]|ข้อ\s*(\d+))\s+(.+)$/u);
    if (!match) return [];
    const index = Number(match[1] || match[2] || 0);
    if (!index) return [];
    return [{ index, label: match[3]!.trim() }];
  });
  if (numbered.length) return numbered.slice(0, 8);
  return extractComparisonOptions(text);
}

export function extractComparisonOptions(text: string | undefined): OfferedOption[] {
  if (!text) return [];
  const vs = text.match(/([A-Za-z][\w .+-]{1,40}?)\s+(?:กับ|vs\.?|versus|\bor\b|หรือ)\s+([A-Za-z][\w .+-]{1,40})/iu);
  if (!vs) return [];
  return [
    { index: 1, label: vs[1]!.trim().replace(/[,:|]+$/u, '') },
    { index: 2, label: vs[2]!.trim().replace(/^[,:|]+/u, '') },
  ];
}

export function pickRecommendedOption(
  options: OfferedOption[],
  hint?: string,
): OfferedOption | undefined {
  if (!options.length) return undefined;
  const lighter = /เบา|light|smaller bundle|less (?:heavy|weight)|เบากว่า/iu.test(hint || '');
  if (lighter) {
    const light = options.find(item => /framer|(?:^|\b)motion(?:\b|$)/iu.test(item.label) && !/gsap/iu.test(item.label));
    if (light) return light;
  }
  return options[0];
}

export function conversationDebugView(
  state: ConversationState,
  extra: { intent?: DiscourseAct; capabilityId?: string; permissionOutcome?: string } = {},
): ConversationDebugView {
  return {
    ...(extra.intent || state.lastDiscourse ? { intent: extra.intent || state.lastDiscourse } : {}),
    ...(state.referents.this_project || state.activeProjectSlug
      ? { referent: state.referents.this_project || state.activeProjectSlug }
      : {}),
    ...(state.activeGoalId ? { goalId: state.activeGoalId } : {}),
    ...(state.activePlanId ? { planId: state.activePlanId } : {}),
    ...(state.activeProjectSlug ? { projectId: state.activeProjectSlug } : {}),
    ...(extra.capabilityId ? { capabilityId: extra.capabilityId } : {}),
    ...(extra.permissionOutcome ? { permissionOutcome: extra.permissionOutcome } : {}),
  };
}

export function slugFromWorkspacePath(workspace?: string): string | undefined {
  if (!workspace) return undefined;
  const leaf = workspace.replace(/\\/gu, '/').replace(/\/+$/u, '').split('/').pop();
  return leaf && leaf !== 'builds' ? leaf : undefined;
}

import fs from 'node:fs';
import path from 'node:path';
import { jarvisDataRoot, jarvisWorkspaceLogicalPath } from '../edition/resolve';
import { emptyConversationState, type ConversationState, type ProjectRecord } from './types';
import { isReportableFailure } from './view';

export type ConversationHydration = {
  sessionId: string;
  projects?: ProjectRecord[];
  activeProjectSlug?: string;
  activePlanId?: string;
  activeGoalId?: string;
  pendingPlanReview?: ConversationState['pendingPlanReview'] | null;
  pendingPermission?: ConversationState['pendingPermission'] | null;
  preview?: ConversationState['activePreview'] | null;
};

export class ConversationStateStore {
  private readonly memory = new Map<string, ConversationState>();

  constructor(
    private readonly filePath?: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.load();
  }

  public get(sessionId: string): ConversationState {
    return clone(this.memory.get(sessionId) || emptyConversationState(sessionId, this.now()));
  }

  public put(next: ConversationState): ConversationState {
    const saved = { ...next, updatedAt: this.now() };
    this.memory.set(saved.sessionId, saved);
    this.persist();
    return clone(saved);
  }

  public patch(sessionId: string, update: (current: ConversationState) => ConversationState): ConversationState {
    const current = this.get(sessionId);
    const next = update(current);
    next.revision = current.revision + 1;
    return this.put(next);
  }

  public hydrate(input: ConversationHydration): ConversationState {
    const current = this.get(input.sessionId);
    const slug = input.activeProjectSlug || current.activeProjectSlug || input.projects?.[0]?.slug || current.projects[0]?.slug;
    const stackedPlan = (current.topicStack || []).find(frame => (
      frame.projectSlug === slug && frame.planId
    ))?.planId;
    const leftoverDraft = Boolean(
      input.pendingPlanReview?.planId
      && stackedPlan
      && input.pendingPlanReview.planId !== stackedPlan,
    );
    const projects = mergeProjects(
      current.projects,
      input.projects || [],
      leftoverDraft && slug && stackedPlan ? { slug, planId: stackedPlan } : undefined,
    );
    const planId = leftoverDraft
      ? (current.activePlanId && current.activePlanId !== input.pendingPlanReview!.planId
        ? current.activePlanId
        : stackedPlan)
      : (input.activePlanId || current.activePlanId);
    const preserveTopic = current.activeTopic === 'research'
      || current.activeTopic === 'chat'
      || current.activeTopic === 'queue';
    const lastError = isReportableFailure(current.lastError?.summary)
      ? current.lastError
      : undefined;
    return this.put({
      ...current,
      projects,
      activeProjectSlug: slug,
      activeGoalId: input.activeGoalId || current.activeGoalId || projects.find(item => item.slug === slug)?.goalId,
      activePlanId: planId,
      pendingPlanReview: leftoverDraft || input.pendingPlanReview === null
        ? undefined
        : input.pendingPlanReview ?? current.pendingPlanReview,
      pendingPermission: input.pendingPermission === null
        ? undefined
        : input.pendingPermission ?? current.pendingPermission,
      activePreview: input.preview === null
        ? undefined
        : input.preview ?? current.activePreview,
      activeWorkspace: slug ? jarvisWorkspaceLogicalPath(slug) : current.activeWorkspace,
      lastError,
      referents: {
        ...current.referents,
        ...(slug ? { this_project: slug, this_site: slug, this_app: slug } : {}),
        ...(planId ? { this_plan: planId } : {}),
        ...(input.preview?.url ? { this_preview: input.preview.url } : {}),
        ...(lastError ? {} : { this_error: undefined }),
      },
      activeTopic: preserveTopic ? current.activeTopic : (slug || planId ? 'software' : current.activeTopic),
    });
  }

  private load(): void {
    if (!this.filePath || !fs.existsSync(this.filePath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as { sessions?: ConversationState[] };
      for (const session of parsed.sessions || []) {
        if (session?.sessionId) this.memory.set(session.sessionId, session);
      }
    } catch {
      // Restart with empty conversation state rather than crashing the lab.
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify({
      sessions: [...this.memory.values()],
    }, null, 2), 'utf8');
  }
}

export function defaultConversationStatePath(workspaceRoot = process.cwd()): string {
  return path.join(jarvisDataRoot(workspaceRoot), 'runtime', 'conversation-state.json');
}

function mergeProjects(
  current: ProjectRecord[],
  incoming: ProjectRecord[],
  pin?: { slug: string; planId: string },
): ProjectRecord[] {
  const bySlug = new Map<string, ProjectRecord>();
  for (const item of [...current, ...incoming]) {
    if (!item.slug) continue;
    const existing = bySlug.get(item.slug);
    if (existing?.planId && item.planId && existing.planId !== item.planId) {
      bySlug.set(item.slug, { ...existing, ...item, planId: existing.planId });
    } else {
      bySlug.set(item.slug, { ...existing, ...item });
    }
  }
  if (pin?.slug && pin.planId) {
    const project = bySlug.get(pin.slug);
    if (project) bySlug.set(pin.slug, { ...project, planId: pin.planId });
  }
  return [...bySlug.values()];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

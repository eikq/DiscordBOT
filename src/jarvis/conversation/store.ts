import fs from 'node:fs';
import path from 'node:path';
import { emptyConversationState, type ConversationState, type ProjectRecord } from './types';
import { isPermissionPrompt } from './view';

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
    const projects = mergeProjects(current.projects, input.projects || []);
    const slug = input.activeProjectSlug || current.activeProjectSlug || projects[0]?.slug;
    const planId = input.activePlanId || current.activePlanId;
    const preserveTopic = current.activeTopic === 'research'
      || current.activeTopic === 'chat'
      || current.activeTopic === 'queue';
    const lastError = isPermissionPrompt(current.lastError?.summary)
      ? undefined
      : current.lastError;
    return this.put({
      ...current,
      projects,
      activeProjectSlug: slug,
      activeGoalId: input.activeGoalId || current.activeGoalId || projects.find(item => item.slug === slug)?.goalId,
      activePlanId: planId,
      pendingPlanReview: input.pendingPlanReview === null
        ? undefined
        : input.pendingPlanReview ?? current.pendingPlanReview,
      pendingPermission: input.pendingPermission === null
        ? undefined
        : input.pendingPermission ?? current.pendingPermission,
      activePreview: input.preview === null
        ? undefined
        : input.preview ?? current.activePreview,
      activeWorkspace: slug ? `data/jarvis/builds/${slug}` : current.activeWorkspace,
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
  return path.join(workspaceRoot, 'data', 'jarvis', 'runtime', 'conversation-state.json');
}

function mergeProjects(current: ProjectRecord[], incoming: ProjectRecord[]): ProjectRecord[] {
  const bySlug = new Map<string, ProjectRecord>();
  for (const item of [...current, ...incoming]) {
    if (!item.slug) continue;
    bySlug.set(item.slug, { ...bySlug.get(item.slug), ...item });
  }
  return [...bySlug.values()];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

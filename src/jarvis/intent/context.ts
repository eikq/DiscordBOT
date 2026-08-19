import type { ClarificationState, InteractionContext } from './types';

export const INTENT_CONTEXT_TTL_MS = 10 * 60_000;

export class InteractionContextStore {
  private readonly sessions = new Map<string, InteractionContext>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  public get(sessionId: string): InteractionContext | null {
    const current = this.sessions.get(sessionId);
    if (!current) return null;
    if (current.expiresAt <= this.now()) {
      this.sessions.delete(sessionId);
      return null;
    }
    if (current.pendingClarification && current.pendingClarification.expiresAt <= this.now()) {
      const next = { ...current, pendingClarification: undefined };
      this.sessions.set(sessionId, next);
      return next;
    }
    return current;
  }

  public put(next: InteractionContext): InteractionContext {
    this.sessions.set(next.sessionId, next);
    return next;
  }

  public touch(sessionId: string, patch: Partial<InteractionContext>): InteractionContext {
    const now = this.now();
    const previous = this.get(sessionId);
    const merged: InteractionContext = {
      sessionId,
      ...previous,
      ...patch,
      updatedAt: now,
      expiresAt: now + INTENT_CONTEXT_TTL_MS,
    };
    return this.put(merged);
  }

  public clearClarification(sessionId: string): void {
    const current = this.get(sessionId);
    if (!current?.pendingClarification) return;
    this.put({ ...current, pendingClarification: undefined });
  }

  public setClarification(sessionId: string, clarification: ClarificationState): InteractionContext {
    return this.touch(sessionId, { pendingClarification: clarification, activeIntent: 'clarification' });
  }
}

export function newClarificationId(now = Date.now()): string {
  return `clr_${now.toString(16)}${Math.random().toString(16).slice(2, 6)}`;
}

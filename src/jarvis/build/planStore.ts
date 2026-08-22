import type { DatabaseSync } from 'node:sqlite';
import { BUILD_PLAN_STATUSES, type BuildPlan, type BuildPlanStatus } from './types';

export class BuildPlanStore {
  constructor(private readonly db: DatabaseSync) {}

  public save(plan: BuildPlan): BuildPlan {
    const now = Date.now();
    const next = { ...plan, updatedAt: now };
    this.db.prepare(`
      INSERT INTO build_plans (id, goal_id, session_id, status, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        goal_id = excluded.goal_id,
        session_id = excluded.session_id,
        status = excluded.status,
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(
      next.id,
      next.goalId,
      next.sessionId ?? null,
      next.status,
      JSON.stringify(next),
      next.createdAt,
      next.updatedAt,
    );
    return next;
  }

  public get(id: string): BuildPlan | null {
    const row = this.db.prepare('SELECT payload FROM build_plans WHERE id = ?').get(id) as { payload?: string } | undefined;
    return row?.payload ? parsePlan(row.payload) : null;
  }

  public list(limit = 20): BuildPlan[] {
    return this.db.prepare(
      'SELECT payload FROM build_plans ORDER BY updated_at DESC LIMIT ?',
    ).all(Math.max(1, Math.min(limit, 100))).flatMap(row => {
      const plan = parsePlan(String((row as { payload?: string }).payload || ''));
      return plan ? [plan] : [];
    });
  }

  public latestForSession(sessionId: string): BuildPlan | null {
    const row = this.db.prepare(
      'SELECT payload FROM build_plans WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1',
    ).get(sessionId) as { payload?: string } | undefined;
    return row?.payload ? parsePlan(row.payload) : null;
  }

  public setStatus(id: string, status: BuildPlanStatus): BuildPlan | null {
    const current = this.get(id);
    if (!current) return null;
    if (!(BUILD_PLAN_STATUSES as readonly string[]).includes(status)) return current;
    return this.save({ ...current, status });
  }
}

function parsePlan(raw: string): BuildPlan | null {
  try {
    const parsed = JSON.parse(raw) as BuildPlan;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

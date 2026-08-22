import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type ConversationSource = 'voice' | 'text' | 'system';
export type ConversationRole = 'OWNER' | 'JARVIS';
export type ConversationTurnStatus = 'started' | 'completed' | 'incomplete';

export type ConversationSessionRecord = {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  source: ConversationSource;
  activeGoalId?: string;
  summary?: string;
  modelProfileId?: string;
};

export type ConversationTurnRecord = {
  id: string;
  sessionId: string;
  timestamp: number;
  role: ConversationRole;
  visibleText: string;
  inputMode: ConversationSource | 'system-derived';
  status: ConversationTurnStatus;
  goalId?: string;
  planId?: string;
  modelProfileId?: string;
  memoryRefs: string[];
  operationRefs: string[];
  metadata: Record<string, unknown>;
};

export class ConversationHistoryStore {
  constructor(private readonly db: DatabaseSync) {}

  public ensureSession(input: {
    id: string;
    source?: ConversationSource;
    modelProfileId?: string;
    title?: string;
  }): ConversationSessionRecord {
    const existing = this.getSession(input.id);
    if (existing) return existing;
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO conversation_sessions (id, created_at, updated_at, title, source, model_profile_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      input.id,
      now,
      now,
      (input.title || 'Conversation').slice(0, 120),
      input.source || 'text',
      input.modelProfileId || null,
    );
    return this.getSession(input.id)!;
  }

  public getSession(id: string): ConversationSessionRecord | null {
    const row = this.db.prepare('SELECT * FROM conversation_sessions WHERE id = ?').get(id);
    return row ? mapSession(row as Record<string, unknown>) : null;
  }

  public listSessions(limit = 20): ConversationSessionRecord[] {
    return this.db.prepare(
      'SELECT * FROM conversation_sessions ORDER BY updated_at DESC LIMIT ?',
    ).all(Math.max(1, Math.min(limit, 100))).map(row => mapSession(row as Record<string, unknown>));
  }

  public touchSession(id: string, patch: Partial<Pick<ConversationSessionRecord, 'title' | 'summary' | 'activeGoalId' | 'modelProfileId'>> = {}): void {
    const current = this.ensureSession({ id });
    this.db.prepare(`
      UPDATE conversation_sessions
      SET updated_at = ?, title = ?, summary = ?, active_goal_id = ?, model_profile_id = ?
      WHERE id = ?
    `).run(
      Date.now(),
      patch.title ?? current.title,
      patch.summary ?? current.summary ?? null,
      patch.activeGoalId ?? current.activeGoalId ?? null,
      patch.modelProfileId ?? current.modelProfileId ?? null,
      id,
    );
  }

  public startTurn(input: Omit<ConversationTurnRecord, 'id' | 'timestamp' | 'status' | 'memoryRefs' | 'operationRefs' | 'metadata'> & {
    id?: string;
    memoryRefs?: string[];
    operationRefs?: string[];
    metadata?: Record<string, unknown>;
  }): ConversationTurnRecord {
    this.ensureSession({ id: input.sessionId, source: input.inputMode === 'voice' ? 'voice' : 'text' });
    const record: ConversationTurnRecord = {
      id: input.id || `turn_${randomUUID()}`,
      sessionId: input.sessionId,
      timestamp: Date.now(),
      role: input.role,
      visibleText: redactVisible(input.visibleText),
      inputMode: input.inputMode,
      status: 'started',
      goalId: input.goalId,
      planId: input.planId,
      modelProfileId: input.modelProfileId,
      memoryRefs: input.memoryRefs || [],
      operationRefs: input.operationRefs || [],
      metadata: input.metadata || {},
    };
    this.insertTurn(record);
    this.touchSession(input.sessionId, {
      title: titleFrom(record.visibleText, record.role),
      activeGoalId: record.goalId,
      modelProfileId: record.modelProfileId,
    });
    return record;
  }

  public completeTurn(id: string, visibleText: string, patch: Partial<Pick<ConversationTurnRecord, 'memoryRefs' | 'operationRefs' | 'metadata' | 'goalId' | 'planId'>> = {}): ConversationTurnRecord | null {
    const current = this.getTurn(id);
    if (!current) return null;
    const next: ConversationTurnRecord = {
      ...current,
      visibleText: redactVisible(visibleText),
      status: 'completed',
      memoryRefs: patch.memoryRefs ?? current.memoryRefs,
      operationRefs: patch.operationRefs ?? current.operationRefs,
      metadata: patch.metadata ?? current.metadata,
      goalId: patch.goalId ?? current.goalId,
      planId: patch.planId ?? current.planId,
    };
    this.db.prepare(`
      UPDATE conversation_turns
      SET visible_text = ?, status = ?, memory_refs = ?, operation_refs = ?, metadata = ?, goal_id = ?, plan_id = ?
      WHERE id = ?
    `).run(
      next.visibleText,
      next.status,
      JSON.stringify(next.memoryRefs),
      JSON.stringify(next.operationRefs),
      JSON.stringify(next.metadata),
      next.goalId ?? null,
      next.planId ?? null,
      id,
    );
    this.touchSession(current.sessionId, { activeGoalId: next.goalId });
    return next;
  }

  public markIncomplete(id: string): ConversationTurnRecord | null {
    const current = this.getTurn(id);
    if (!current || current.status === 'completed') return current;
    this.db.prepare(`UPDATE conversation_turns SET status = 'incomplete' WHERE id = ?`).run(id);
    return { ...current, status: 'incomplete' };
  }

  public markAbandonedStarted(_now = Date.now()): number {
    const result = this.db.prepare(
      `UPDATE conversation_turns SET status = 'incomplete' WHERE status = 'started'`,
    ).run();
    return Number(result.changes || 0);
  }

  public getTurn(id: string): ConversationTurnRecord | null {
    const row = this.db.prepare('SELECT * FROM conversation_turns WHERE id = ?').get(id);
    return row ? mapTurn(row as Record<string, unknown>) : null;
  }

  public listTurns(sessionId: string, limit = 50): ConversationTurnRecord[] {
    return this.db.prepare(
      'SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?',
    ).all(sessionId, Math.max(1, Math.min(limit, 200))).map(row => mapTurn(row as Record<string, unknown>));
  }

  public recentTurns(sessionId: string, limit = 12): ConversationTurnRecord[] {
    return this.listTurns(sessionId, 200).slice(-Math.max(1, Math.min(limit, 40)));
  }

  public searchVisible(query: string, limit = 20): ConversationTurnRecord[] {
    const needle = query.trim();
    if (!needle) return [];
    return this.db.prepare(
      `SELECT * FROM conversation_turns
       WHERE visible_text LIKE ? AND status = 'completed'
       ORDER BY timestamp DESC LIMIT ?`,
    ).all(`%${needle.replaceAll('%', '')}%`, Math.max(1, Math.min(limit, 50)))
      .map(row => mapTurn(row as Record<string, unknown>));
  }

  private insertTurn(record: ConversationTurnRecord): void {
    this.db.prepare(`
      INSERT INTO conversation_turns (
        id, session_id, timestamp, role, visible_text, input_mode, status,
        goal_id, plan_id, model_profile_id, memory_refs, operation_refs, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.sessionId,
      record.timestamp,
      record.role,
      record.visibleText,
      record.inputMode,
      record.status,
      record.goalId ?? null,
      record.planId ?? null,
      record.modelProfileId ?? null,
      JSON.stringify(record.memoryRefs),
      JSON.stringify(record.operationRefs),
      JSON.stringify(record.metadata),
    );
  }
}

function redactVisible(text: string): string {
  return text
    .replace(/(?:DISCORD_TOKEN|API_KEY|OPENAI_API_KEY|LOCAL_QWEN_API_KEY|JARVIS_QWEN_API_KEY|BEARER|PASSWORD|SECRET|TOKEN)\s*[=:]\s*\S+/giu, '[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/giu, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g, '[REDACTED]')
    .slice(0, 8_000);
}

function titleFrom(text: string, role: ConversationRole): string {
  if (role !== 'OWNER') return 'Conversation';
  const compact = text.replace(/\s+/gu, ' ').trim();
  return compact.slice(0, 72) || 'Conversation';
}

function mapSession(row: Record<string, unknown>): ConversationSessionRecord {
  return {
    id: String(row.id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    title: String(row.title || 'Conversation'),
    source: (row.source as ConversationSource) || 'text',
    ...(row.active_goal_id ? { activeGoalId: String(row.active_goal_id) } : {}),
    ...(row.summary ? { summary: String(row.summary) } : {}),
    ...(row.model_profile_id ? { modelProfileId: String(row.model_profile_id) } : {}),
  };
}

function mapTurn(row: Record<string, unknown>): ConversationTurnRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    timestamp: Number(row.timestamp),
    role: row.role === 'JARVIS' ? 'JARVIS' : 'OWNER',
    visibleText: String(row.visible_text || ''),
    inputMode: (row.input_mode as ConversationTurnRecord['inputMode']) || 'text',
    status: (row.status as ConversationTurnStatus) || 'incomplete',
    ...(row.goal_id ? { goalId: String(row.goal_id) } : {}),
    ...(row.plan_id ? { planId: String(row.plan_id) } : {}),
    ...(row.model_profile_id ? { modelProfileId: String(row.model_profile_id) } : {}),
    memoryRefs: parseJsonArray(row.memory_refs),
    operationRefs: parseJsonArray(row.operation_refs),
    metadata: parseJsonObject(row.metadata),
  };
}

function parseJsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(item => String(item)) : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

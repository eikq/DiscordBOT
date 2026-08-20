import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { clipPreservingCombining } from '../i18n/thaiIntegrity';
import { redactDeep, redactSecrets } from '../security/redaction';
import { FORBIDDEN_TRACE_KEYS, type JarvisTraceRecord, type TraceCapabilityRef } from './traceTypes';

const DEFAULT_MAX = 500;
const INPUT_MAX = 2_000;

export type TraceRecordInput = Omit<JarvisTraceRecord, 'id' | 'at'> & {
  id?: string;
  at?: string;
};

export class TraceStore {
  private readonly items: JarvisTraceRecord[] = [];
  private readonly maxRows: number;
  private readonly now: () => number;
  private readonly db?: DatabaseSync;

  constructor(options: { db?: DatabaseSync; now?: () => number; maxRows?: number } = {}) {
    this.db = options.db;
    this.now = options.now ?? (() => Date.now());
    this.maxRows = options.maxRows ?? DEFAULT_MAX;
    if (this.db) {
      const rows = this.db.prepare('SELECT payload FROM traces ORDER BY at DESC LIMIT ?').all(this.maxRows) as Array<{ payload: string }>;
      for (const row of rows.reverse()) {
        this.items.push(JSON.parse(String(row.payload)) as JarvisTraceRecord);
      }
    }
  }

  public record(input: TraceRecordInput): JarvisTraceRecord {
    const cleaned = sanitizeTrace(input);
    const record: JarvisTraceRecord = {
      ...cleaned,
      id: input.id?.trim() || `tr_${randomBytes(6).toString('hex')}`,
      at: input.at ?? new Date(this.now()).toISOString(),
    };
    this.items.push(record);
    while (this.items.length > this.maxRows) this.items.shift();
    if (this.db) {
      this.db.prepare('INSERT OR REPLACE INTO traces(id, at, payload) VALUES (?, ?, ?)').run(
        record.id,
        record.at,
        JSON.stringify(record),
      );
      const extra = Number(this.db.prepare('SELECT COUNT(*) AS n FROM traces').get()?.n || 0) - this.maxRows;
      if (extra > 0) {
        this.db.prepare(
          'DELETE FROM traces WHERE id IN (SELECT id FROM traces ORDER BY at ASC LIMIT ?)',
        ).run(extra);
      }
    }
    return { ...record, memoryRefs: clone(record.memoryRefs), skillRefs: clone(record.skillRefs), capabilities: clone(record.capabilities), sources: clone(record.sources), toolResults: clone(record.toolResults), errors: clone(record.errors) };
  }

  public list(limit = 40): JarvisTraceRecord[] {
    return this.items.slice(-limit).map(item => ({ ...item }));
  }

  public count(): number {
    return this.items.length;
  }

  public get(id: string): JarvisTraceRecord | undefined {
    const found = this.items.find(item => item.id === id);
    return found ? { ...found } : undefined;
  }
}

function isSecretTraceKey(key: string): boolean {
  return /^(password|secret|token|confirmToken|confirmationToken|rawConfirmationToken|cookie|cookies|authorization|api[_-]?key|dotenv|envFile|rvc|rvcModel|voiceSecret|consentToken|rawAudio|datasetPath|wavPath)$/iu.test(key)
    || /\.env/iu.test(key);
}

function clone<T>(value: T[] | undefined): T[] | undefined {
  if (!value) return undefined;
  return value.map(item => (item && typeof item === 'object' ? { ...item } as T : item));
}

function sanitizeTrace(input: TraceRecordInput): TraceRecordInput {
  const record: Record<string, unknown> = { ...input };
  for (const key of [...FORBIDDEN_TRACE_KEYS, 'prompt']) {
    delete record[key];
  }
  for (const key of Object.keys(record)) {
    if (isSecretTraceKey(key)) delete record[key];
  }
  const cleaned = redactDeep(record) as Record<string, unknown>;
  if (typeof cleaned.inputText === 'string') {
    cleaned.inputText = clipPreservingCombining(redactSecrets(cleaned.inputText), INPUT_MAX);
  }
  if (Array.isArray(cleaned.capabilities)) {
    cleaned.capabilities = cleaned.capabilities
      .map(normalizeCapability)
      .filter((item): item is TraceCapabilityRef => Boolean(item));
  }
  return cleaned as TraceRecordInput;
}

function normalizeCapability(value: unknown): TraceCapabilityRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as { id?: unknown; status?: unknown; risk?: unknown };
  if (typeof item.id !== 'string' || !item.id.trim()) return undefined;
  if (typeof item.status !== 'string' || !item.status.trim()) return undefined;
  return {
    id: item.id.trim(),
    status: item.status.trim(),
    ...(typeof item.risk === 'string' && item.risk.trim() ? { risk: item.risk.trim() } : {}),
  };
}

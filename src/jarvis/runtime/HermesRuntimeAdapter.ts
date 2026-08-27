import type {
  AgentEvent,
  AgentRun,
  AgentRunInput,
  AgentRunStatus,
  AgentRuntime,
  ApprovalDecision,
  RuntimeCapabilities,
  WaitForRunOptions,
} from './types';
import { isAgentRunTerminal } from './types';
import type { HermesRuntimeConfig } from './config';

export type HermesRuntimeAdapterOptions = HermesRuntimeConfig & {
  fetchImpl?: typeof fetch;
};

export class HermesRuntimeError extends Error {
  public readonly status?: number;
  public readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'HermesRuntimeError';
    this.status = status;
    this.code = code;
  }
}

export class HermesRuntimeAdapter implements AgentRuntime {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  constructor(options: HermesRuntimeAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/u, '');
    this.apiKey = options.apiKey;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async getCapabilities(): Promise<RuntimeCapabilities> {
    const raw = await this.requestJson('GET', '/v1/capabilities');
    const auth = objectOf(raw.auth);
    return {
      platform: stringOf(raw.platform),
      model: stringOf(raw.model),
      authRequired: auth.required === true,
      features: objectOf(raw.features),
      endpoints: objectOf(raw.endpoints),
      raw,
    };
  }

  public async startRun(input: AgentRunInput): Promise<AgentRun> {
    const text = String(input.input || '').trim();
    if (!text) throw new Error('Agent run input is required.');
    const body: Record<string, unknown> = { input: text };
    if (input.sessionId) body.session_id = input.sessionId;
    if (input.instructions) body.instructions = input.instructions;
    if (input.conversationHistory?.length) body.conversation_history = input.conversationHistory;
    if (input.previousResponseId) body.previous_response_id = input.previousResponseId;
    if (input.model) body.model = input.model;
    const raw = await this.requestJson('POST', '/v1/runs', body, input.sessionKey);
    return normalizeRun(raw);
  }
  public async getRun(runId: string): Promise<AgentRun> {
    const raw = await this.requestJson('GET', `/v1/runs/${encodeURIComponent(runId)}`);
    return normalizeRun(raw);
  }

  public async *streamEvents(runId: string, signal?: AbortSignal): AsyncIterable<AgentEvent> {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/runs/${encodeURIComponent(runId)}/events`, {
      method: 'GET',
      headers: this.headers(undefined, true),
      signal,
    });
    if (!response.ok) {
      throw await responseError(response);
    }
    if (!response.body) {
      throw new HermesRuntimeError('Hermes event stream returned no response body.', response.status);
    }
    for await (const raw of parseSse(response.body)) {
      yield normalizeEvent(raw, runId);
    }
  }

  public async approve(runId: string, decision: ApprovalDecision, resolveAll = false): Promise<void> {
    await this.requestJson('POST', `/v1/runs/${encodeURIComponent(runId)}/approval`, {
      choice: decision,
      ...(resolveAll ? { resolve_all: true } : {}),
    });
  }

  public async steer(runId: string, instruction: string): Promise<void> {
    const input = String(instruction || '').trim();
    if (!input) throw new Error('Steer instruction is required.');
    await this.requestJson('POST', `/v1/runs/${encodeURIComponent(runId)}/steer`, { input });
  }
  public async stop(runId: string): Promise<void> {
    await this.requestJson('POST', `/v1/runs/${encodeURIComponent(runId)}/stop`, {});
  }

  public async waitForRun(runId: string, options: WaitForRunOptions = {}): Promise<AgentRun> {
    const pollIntervalMs = Math.max(10, options.pollIntervalMs ?? 250);
    const timeoutMs = Math.max(pollIntervalMs, options.timeoutMs ?? 120_000);
    const started = Date.now();
    while (true) {
      if (options.signal?.aborted) throw abortError();
      const run = await this.getRun(runId);
      if (isAgentRunTerminal(run.status)) return run;
      if (Date.now() - started >= timeoutMs) {
        throw new HermesRuntimeError(`Timed out waiting for Hermes run ${runId}.`);
      }
      await sleep(pollIntervalMs, options.signal);
    }
  }

  private async requestJson(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    sessionKey?: string,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(sessionKey, body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });      if (!response.ok) throw await responseError(response);
      const parsed = await response.json();
      return objectOf(parsed);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new HermesRuntimeError(`Hermes request timed out after ${this.requestTimeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private headers(sessionKey?: string, json = false): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(sessionKey ? { 'X-Hermes-Session-Key': sessionKey } : {}),
    };
  }
}

function normalizeRun(raw: Record<string, unknown>): AgentRun {
  const usage = objectOf(raw.usage);
  return {
    runId: stringOf(raw.run_id) || '',
    status: normalizeStatus(raw.status),
    sessionId: stringOf(raw.session_id),
    model: stringOf(raw.model),
    output: stringOf(raw.output),
    error: stringOf(raw.error),
    usage: Object.keys(usage).length ? {
      inputTokens: numberOf(usage.input_tokens),
      outputTokens: numberOf(usage.output_tokens),
      totalTokens: numberOf(usage.total_tokens),
    } : undefined,    lastEvent: stringOf(raw.last_event),
    pendingSteer: stringOf(raw.pending_steer),
  };
}

function normalizeEvent(raw: Record<string, unknown>, fallbackRunId: string): AgentEvent {
  const choice = stringOf(raw.choice);
  return {
    type: stringOf(raw.event) || 'unknown',
    runId: stringOf(raw.run_id) || fallbackRunId,
    timestamp: numberOf(raw.timestamp),
    tool: stringOf(raw.tool),
    preview: stringOf(raw.preview),
    duration: numberOf(raw.duration),
    error: typeof raw.error === 'boolean' || typeof raw.error === 'string' ? raw.error : undefined,
    delta: stringOf(raw.delta),
    output: stringOf(raw.output),
    choice: isApprovalDecision(choice) ? choice : undefined,
    choices: Array.isArray(raw.choices) ? raw.choices.map(String) : undefined,
    raw,
  };
}

function normalizeStatus(value: unknown): AgentRunStatus {
  const status = String(value || '').trim();
  const known: AgentRunStatus[] = [
    'started', 'queued', 'running', 'waiting_for_approval', 'stopping',
    'completed', 'failed', 'cancelled',
  ];
  return known.includes(status as AgentRunStatus) ? status as AgentRunStatus : 'unknown';
}
async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      let boundary = frameBoundary(buffer);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + frameSeparatorLength(buffer, boundary));
        const parsed = parseSseFrame(frame);
        if (parsed) yield parsed;
        boundary = frameBoundary(buffer);
      }
      if (done) break;
    }
    const trailing = parseSseFrame(buffer);
    if (trailing) yield trailing;
  } finally {
    reader.releaseLock();
  }
}

function parseSseFrame(frame: string): Record<string, unknown> | undefined {
  const data = frame.split(/\r?\n/u)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  if (!data) return undefined;
  try {
    return objectOf(JSON.parse(data));
  } catch {
    return { event: 'stream.parse_error', error: 'Invalid JSON in Hermes SSE frame.' };
  }
}
function frameBoundary(value: string): number {
  const lf = value.indexOf('\n\n');
  const crlf = value.indexOf('\r\n\r\n');
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}

function frameSeparatorLength(value: string, boundary: number): number {
  return value.startsWith('\r\n\r\n', boundary) ? 4 : 2;
}

async function responseError(response: Response): Promise<HermesRuntimeError> {
  let raw: Record<string, unknown> = {};
  try {
    raw = objectOf(await response.json());
  } catch {
    // Keep transport failures concise; never echo Authorization headers.
  }
  const nested = objectOf(raw.error);
  const message = stringOf(nested.message) || stringOf(raw.message) || `Hermes request failed with HTTP ${response.status}.`;
  const code = stringOf(nested.code) || stringOf(raw.code);
  return new HermesRuntimeError(message, response.status, code);
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined;
}
function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isApprovalDecision(value: string | undefined): value is ApprovalDecision {
  return value === 'once' || value === 'session' || value === 'always' || value === 'deny';
}

function abortError(): Error {
  const error = new Error('Agent run wait aborted.');
  error.name = 'AbortError';
  return error;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (!signal) return;
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    setTimeout(cleanup, ms + 1);
  });
}
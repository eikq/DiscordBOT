import dotenv from 'dotenv';
import { ollamaMetricsFromChat, type LlmTurnMetrics } from './ollamaMetrics';
import { ownerMessageForModelHealth, type ModelHealthStatus } from './modelHealth';
import { openaiCompatibleHeaders, resolveLocalQwenApiKey } from './openaiCompatibleAuth';
import { parseOpenAiToolCalls, visibleModelText } from './visibleModelText';
dotenv.config({ quiet: true });

/** Discord/Digital Me no-arg default. Jarvis callers pass 8086 / qwen38-cyber explicitly. */
const DISCORD_LLM_BASE_URL = 'http://127.0.0.1:11434/v1';
const DISCORD_LLM_MODEL = 'digital-me-qwen38:27b-ad-q4km';

export interface StructuredGenerationRequest {
  systemPrompt?: string;
  userPrompt: string;
  schema?: Record<string, any>;
  temperature?: number;
  maxTokens?: number;
}

export type TextGenerationResult = {
  text: string | null;
  metrics?: LlmTurnMetrics;
  health?: ModelHealthStatus;
};

export type TextGenerationRequest = {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  onDraft?: (delta: string, accumulated: string) => void;
};

export type LlmToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LlmToolCall = {
  id?: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolExecutionResult = {
  content: string;
  sources?: string[];
};

export interface ToolGenerationRequest extends TextGenerationRequest {
  tools: LlmToolDefinition[];
  executeTool: (call: LlmToolCall) => Promise<ToolExecutionResult>;
  maxToolRounds?: number;
}

export type ToolGenerationResult = {
  text: string | null;
  calls: LlmToolCall[];
  sources: string[];
};

export type LocalLlmRuntimeStatus = {
  provider: 'ollama' | 'openai-compatible';
  baseUrl: string;
  model: string;
  enabled: boolean;
  reachable: boolean;
  modelAvailable?: boolean;
  health: ModelHealthStatus;
  version?: string;
  installedModels?: string[];
  loaded?: boolean;
  sizeVramBytes?: number;
  error?: string;
  ownerMessage?: string;
  authConfigured?: boolean;
};

export class LocalLlmProvider {
  private static offlineUntil = 0;
  private baseUrl: string;
  private modelName: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, modelName?: string) {
    this.baseUrl = (baseUrl || process.env.LLM_BASE_URL || DISCORD_LLM_BASE_URL).replace(/\/$/, '');
    this.modelName = modelName || process.env.LLM_MODEL || DISCORD_LLM_MODEL;
    this.timeoutMs = this.readPositiveInteger(process.env.LLM_TIMEOUT_MS, 60_000);
  }

  public async generateStructured<T>(request: StructuredGenerationRequest): Promise<T | null> {
    if (!this.canAttempt()) return null;
    const startedAt = Date.now();
    const messages = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.userPrompt });

    try {
      const ollamaUrl = this.ollamaNativeUrl();
      const response = await fetch(ollamaUrl ? `${ollamaUrl}/api/chat` : `${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify(ollamaUrl ? {
          model: this.modelName,
          messages,
          stream: false,
          think: false,
          keep_alive: this.ollamaKeepAlive(),
          format: request.schema || 'json',
          options: this.ollamaOptions(request.temperature ?? 0.2, request.maxTokens ?? 120),
        } : {
          model: this.modelName,
          messages,
          temperature: request.temperature ?? 0.2,
          max_tokens: request.maxTokens ?? 120,
          ...this.optionalReasoningEffort('none'),
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.ok) {
        const json = await response.json() as Record<string, any>;
        const content = ollamaUrl ? json.message?.content : json.choices?.[0]?.message?.content;
        const visible = visibleModelText(content, json.choices?.[0]?.message?.reasoning_content);
        if (visible) {
          console.log(`[LocalLLM] Structured response in ${Date.now() - startedAt}ms.`);
          return JSON.parse(visible) as T;
        }
      } else if (response.status !== 401 && response.status !== 403) {
        this.markOffline();
      }
    } catch (err: any) {
      console.warn(`[LocalLLM] Structured request failed after ${Date.now() - startedAt}ms: ${err instanceof Error ? err.message : String(err)}`);
      this.markOffline();
    }

    return null;
  }

  public async generateText(request: TextGenerationRequest): Promise<string | null> {
    return (await this.generateTextDetailed(request)).text;
  }

  public async generateTextDetailed(request: TextGenerationRequest): Promise<TextGenerationResult> {
    if (!this.canAttempt()) return { text: null, health: 'MODEL_OFFLINE' };
    const startedAt = Date.now();
    const messages = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.userPrompt });
    const promptChars = messages.reduce((sum, item) => sum + item.content.length, 0);
    const ollamaUrl = this.ollamaNativeUrl();

    try {
      if (ollamaUrl && request.onDraft) {
        return await this.streamOllamaChat(ollamaUrl, messages, request, startedAt, promptChars);
      }
      if (!ollamaUrl && request.onDraft) {
        return await this.streamOpenAiChat(messages, request, startedAt, promptChars);
      }

      const response = await fetch(ollamaUrl ? `${ollamaUrl}/api/chat` : `${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.requestHeaders(),
        body: JSON.stringify(ollamaUrl ? {
          model: this.modelName,
          messages,
          stream: false,
          think: false,
          keep_alive: this.ollamaKeepAlive(),
          options: this.ollamaOptions(request.temperature ?? 0.7, request.maxTokens ?? 60),
        } : {
          model: this.modelName,
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 60,
          presence_penalty: 1.1,
          ...this.optionalReasoningEffort('none'),
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (response.ok) {
        const json = await response.json() as Record<string, any>;
        const message = ollamaUrl ? json.message : json.choices?.[0]?.message;
        const text = visibleModelText(message?.content, message?.reasoning_content);
        if (text) {
          console.log(`[LocalLLM] Spoken response in ${Date.now() - startedAt}ms.`);
          const metrics = ollamaUrl
            ? ollamaMetricsFromChat(json, { promptChars, ttftMs: Date.now() - startedAt })
            : { promptChars };
          return { text, metrics, health: 'MODEL_READY' };
        }
        return { text: null, health: 'MODEL_READY' };
      }
      if (response.status === 401 || response.status === 403) {
        return { text: null, health: 'AUTH_FAILED' };
      }
      this.markOffline();
      return { text: null, health: 'MODEL_UNREACHABLE' };
    } catch (err: any) {
      console.warn(`[LocalLLM] Spoken request failed after ${Date.now() - startedAt}ms: ${err instanceof Error ? err.message : String(err)}`);
      this.markOffline();
    }

    return { text: null, health: 'MODEL_UNREACHABLE' };
  }

  public async generateWithTools(request: ToolGenerationRequest): Promise<ToolGenerationResult> {
    if (!this.canAttempt()) {
      throw new Error('Local LLM is disabled or in retry cooldown.');
    }
    const ollamaUrl = this.ollamaNativeUrl();
    const messages: Array<Record<string, unknown>> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.userPrompt });
    const calls: LlmToolCall[] = [];
    const sources = new Set<string>();
    const maxToolRounds = Math.min(4, Math.max(1, request.maxToolRounds ?? 2));

    try {
      for (let round = 0; round <= maxToolRounds; round++) {
        const response = await fetch(ollamaUrl ? `${ollamaUrl}/api/chat` : `${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: this.requestHeaders(),
          body: JSON.stringify(ollamaUrl ? {
            model: this.modelName,
            messages,
            tools: request.tools,
            stream: false,
            think: false,
            keep_alive: this.ollamaKeepAlive(),
            options: this.ollamaOptions(request.temperature ?? 0.2, request.maxTokens ?? 700),
          } : {
            model: this.modelName,
            messages,
            tools: request.tools,
            temperature: request.temperature ?? 0.2,
            max_tokens: request.maxTokens ?? 700,
            ...this.optionalReasoningEffort(process.env.LLM_RESEARCH_REASONING_EFFORT || ''),
          }),
          signal: AbortSignal.timeout(this.readPositiveInteger(process.env.LLM_RESEARCH_TIMEOUT_MS, 120_000)),
        });

        if (!response.ok) {
          const details = (await response.text().catch(() => '')).trim().slice(0, 800);
          if (response.status !== 401 && response.status !== 403) this.markOffline();
          throw new Error(`LLM tool request returned HTTP ${response.status}${details ? `: ${details}` : ''}`);
        }

        const json = await response.json() as Record<string, any>;
        const assistantMessage = ollamaUrl ? json.message : json.choices?.[0]?.message;
        const toolCalls = parseOpenAiToolCalls(assistantMessage?.tool_calls);
        if (toolCalls.length === 0) {
          const text = visibleModelText(assistantMessage?.content, assistantMessage?.reasoning_content);
          return { text, calls, sources: [...sources] };
        }
        if (round === maxToolRounds) {
          throw new Error(`LLM exceeded the ${maxToolRounds}-round tool limit.`);
        }

        messages.push(assistantMessage);
        for (const call of toolCalls) {
          calls.push(call);
          const result = await request.executeTool(call);
          for (const source of result.sources || []) sources.add(source);
          messages.push(ollamaUrl ? {
            role: 'tool',
            tool_name: call.name,
            content: result.content,
          } : {
            role: 'tool',
            tool_call_id: call.id,
            content: result.content,
          });
        }
      }
    } catch (error) {
      console.warn(`[LocalLLM] Tool generation failed: ${error instanceof Error ? error.message : String(error)}`);
      this.markOffline();
      throw error;
    }

    return { text: null, calls, sources: [...sources] };
  }

  public async getRuntimeStatus(): Promise<LocalLlmRuntimeStatus> {
    const ollamaUrl = this.ollamaNativeUrl();
    const authConfigured = Boolean(resolveLocalQwenApiKey());
    const base: LocalLlmRuntimeStatus = {
      provider: ollamaUrl ? 'ollama' : 'openai-compatible',
      baseUrl: ollamaUrl || this.baseUrl,
      model: this.modelName,
      enabled: process.env.LLM_ENABLED !== 'false',
      reachable: false,
      health: process.env.LLM_ENABLED === 'false' ? 'MODEL_OFFLINE' : 'MODEL_UNREACHABLE',
      authConfigured,
    };
    if (process.env.LLM_ENABLED === 'false') {
      return { ...base, ownerMessage: ownerMessageForModelHealth('MODEL_OFFLINE') };
    }
    try {
      if (ollamaUrl) {
        const [versionResponse, tagsResponse, psResponse] = await Promise.all([
          fetch(`${ollamaUrl}/api/version`, { signal: AbortSignal.timeout(3_000) }),
          fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) }),
          fetch(`${ollamaUrl}/api/ps`, { signal: AbortSignal.timeout(3_000) }).catch(() => undefined),
        ]);
        if (!versionResponse.ok || !tagsResponse.ok) throw new Error('Ollama health endpoints failed.');
        const version = await versionResponse.json();
        const tags = await tagsResponse.json();
        const installedModels = Array.isArray(tags.models)
          ? tags.models.map((model: any) => String(model.name || model.model || '')).filter(Boolean)
          : [];
        const loadedInfo = psResponse?.ok ? await psResponse.json() as { models?: Array<{ name?: string; model?: string; size_vram?: number }> } : undefined;
        const loadedEntry = (loadedInfo?.models || []).find(item => item.name === this.modelName || item.model === this.modelName);
        const modelAvailable = this.hasConfiguredModel(installedModels);
        const health: ModelHealthStatus = modelAvailable ? 'MODEL_READY' : 'MODEL_NOT_FOUND';
        return {
          ...base,
          reachable: true,
          version: typeof version.version === 'string' ? version.version : undefined,
          installedModels,
          modelAvailable,
          health,
          loaded: Boolean(loadedEntry),
          ...(typeof loadedEntry?.size_vram === 'number' ? { sizeVramBytes: loadedEntry.size_vram } : {}),
          ...(health === 'MODEL_READY' ? {} : { ownerMessage: ownerMessageForModelHealth(health) }),
        };
      }

      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.requestHeaders(),
        signal: AbortSignal.timeout(3_000),
      });
      if (response.status === 401 || response.status === 403) {
        return {
          ...base,
          health: 'AUTH_FAILED',
          error: `Model endpoint returned HTTP ${response.status}`,
          ownerMessage: ownerMessageForModelHealth('AUTH_FAILED'),
        };
      }
      if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}`);
      const json = await response.json();
      const installedModels = Array.isArray(json.data)
        ? json.data.map((model: any) => String(model.id || '')).filter(Boolean)
        : [];
      const modelAvailable = this.hasConfiguredModel(installedModels);
      const health: ModelHealthStatus = modelAvailable ? 'MODEL_READY' : 'MODEL_NOT_FOUND';
      return {
        ...base,
        reachable: true,
        installedModels,
        modelAvailable,
        health,
        ...(health === 'MODEL_READY' ? {} : { ownerMessage: ownerMessageForModelHealth(health) }),
      };
    } catch (error) {
      return {
        ...base,
        health: 'MODEL_UNREACHABLE',
        error: error instanceof Error ? error.message : String(error),
        ownerMessage: ownerMessageForModelHealth('MODEL_UNREACHABLE'),
      };
    }
  }

  public async *streamText(request: TextGenerationRequest): AsyncIterable<string> {
    let accumulated = '';
    const result = await this.generateTextDetailed({
      ...request,
      onDraft: (delta, next) => {
        accumulated = next;
        void delta;
      },
    });
    if (result.text) {
      if (accumulated) {
        yield result.text;
        return;
      }
      yield result.text;
    }
  }

  public async cancel(requestId: string): Promise<void> {
    console.log(`[LocalLlmProvider] Cancelled generation request: ${requestId}`);
  }

  private async streamOllamaChat(
    ollamaUrl: string,
    messages: Array<{ role: string; content: string }>,
    request: TextGenerationRequest,
    startedAt: number,
    promptChars: number,
  ): Promise<TextGenerationResult> {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: this.requestHeaders(),
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: true,
        think: false,
        keep_alive: this.ollamaKeepAlive(),
        options: this.ollamaOptions(request.temperature ?? 0.7, request.maxTokens ?? 60),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok || !response.body) {
      this.markOffline();
      return { text: null, health: 'MODEL_UNREACHABLE' };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let ttftMs: number | undefined;
    let metricsPayload: Record<string, unknown> | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let payload: Record<string, any>;
        try {
          payload = JSON.parse(trimmed);
        } catch {
          continue;
        }
        const delta = typeof payload.message?.content === 'string' ? payload.message.content : '';
        if (delta) {
          if (ttftMs === undefined) ttftMs = Date.now() - startedAt;
          accumulated += delta;
          const visible = visibleModelText(accumulated) || accumulated;
          request.onDraft?.(delta, visible);
        }
        if (payload.done) metricsPayload = payload;
      }
    }
    const text = visibleModelText(accumulated);
    if (text) {
      console.log(`[LocalLLM] Spoken response in ${Date.now() - startedAt}ms.`);
      return {
        text,
        health: 'MODEL_READY',
        metrics: ollamaMetricsFromChat(metricsPayload || {}, { promptChars, ttftMs }),
      };
    }
    return { text: null, health: 'MODEL_READY' };
  }

  private async streamOpenAiChat(
    messages: Array<{ role: string; content: string }>,
    request: TextGenerationRequest,
    startedAt: number,
    promptChars: number,
  ): Promise<TextGenerationResult> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.requestHeaders(),
      body: JSON.stringify({
        model: this.modelName,
        messages,
        stream: true,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 60,
        presence_penalty: 1.1,
        ...this.optionalReasoningEffort('none'),
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 401 || response.status === 403) {
      return { text: null, health: 'AUTH_FAILED' };
    }
    if (!response.ok || !response.body) {
      this.markOffline();
      return { text: null, health: 'MODEL_UNREACHABLE' };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let ttftMs: number | undefined;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        const payloadLine = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
        if (!payloadLine || payloadLine === '[DONE]') continue;
        let payload: Record<string, any>;
        try {
          payload = JSON.parse(payloadLine);
        } catch {
          continue;
        }
        const delta = payload.choices?.[0]?.delta;
        const piece = typeof delta?.content === 'string' ? delta.content : '';
        if (piece) {
          if (ttftMs === undefined) ttftMs = Date.now() - startedAt;
          accumulated += piece;
          const visible = visibleModelText(accumulated) || accumulated;
          request.onDraft?.(piece, visible);
        }
      }
    }
    const text = visibleModelText(accumulated);
    if (text) {
      console.log(`[LocalLLM] Spoken response in ${Date.now() - startedAt}ms.`);
      return { text, health: 'MODEL_READY', metrics: { promptChars, ttftMs } };
    }
    return { text: null, health: 'MODEL_READY' };
  }

  private canAttempt(): boolean {
    return process.env.LLM_ENABLED !== 'false' && Date.now() >= LocalLlmProvider.offlineUntil;
  }

  private markOffline(): void {
    const retryMs = this.readPositiveInteger(process.env.LLM_RETRY_COOLDOWN_MS, 5000);
    LocalLlmProvider.offlineUntil = Date.now() + retryMs;
  }

  private readPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private requestHeaders(): Record<string, string> {
    return openaiCompatibleHeaders();
  }

  private optionalReasoningEffort(fallback: string): Record<string, string> {
    const configured = process.env.LLM_REASONING_EFFORT?.trim() || fallback.trim();
    if (!configured) return {};
    return { reasoning_effort: configured };
  }

  private ollamaNativeUrl(): string | null {
    const runtime = process.env.LLM_RUNTIME?.trim().toLowerCase();
    if (runtime === 'openai-compatible' || runtime === 'openai') return null;
    if (runtime === 'ollama') {
      const configured = process.env.LLM_NATIVE_URL?.trim();
      if (configured) return configured.replace(/\/$/, '');
      try {
        const parsed = new URL(this.baseUrl);
        return `${parsed.protocol}//${parsed.host}`;
      } catch {
        return 'http://127.0.0.1:11434';
      }
    }
    const configured = process.env.LLM_NATIVE_URL?.trim();
    if (configured) return configured.replace(/\/$/, '');
    try {
      const parsed = new URL(this.baseUrl);
      return parsed.port === '11434' ? `${parsed.protocol}//${parsed.host}` : null;
    } catch {
      return null;
    }
  }

  private ollamaOptions(temperature: number, maxTokens: number): Record<string, number> {
    return {
      temperature,
      num_predict: maxTokens,
      num_ctx: this.readPositiveInteger(process.env.LLM_CONTEXT_TOKENS, 8192),
      num_gpu: Math.max(0, Number(process.env.LLM_GPU_LAYERS || 999)),
      presence_penalty: 1.1,
    };
  }

  private ollamaKeepAlive(): string | number {
    const value = process.env.LLM_KEEP_ALIVE?.trim();
    if (!value) return '10m';
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
  }

  private hasConfiguredModel(installedModels: string[]): boolean {
    if (installedModels.includes(this.modelName)) return true;
    if (this.modelName.includes(':')) return false;
    return installedModels.some(model => model === `${this.modelName}:latest` || model.split(':', 1)[0] === this.modelName);
  }
}

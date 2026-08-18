import dotenv from 'dotenv';

dotenv.config({ quiet: true });

export interface StructuredGenerationRequest {
  systemPrompt?: string;
  userPrompt: string;
  schema?: Record<string, any>;
  temperature?: number;
  maxTokens?: number;
}

export interface TextGenerationRequest {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

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
  version?: string;
  installedModels?: string[];
  error?: string;
};

export class LocalLlmProvider {
  private static offlineUntil = 0;
  private baseUrl: string;
  private modelName: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, modelName?: string) {
    this.baseUrl = baseUrl || process.env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1';
    this.modelName = modelName || process.env.LLM_MODEL || 'digital-me-qwen38:27b-ad-q4km';
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
        headers: { 'Content-Type': 'application/json' },
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
          reasoning_effort: 'none',
          response_format: { type: 'json_object' }
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (response.ok) {
        const json = await response.json();
        const content = ollamaUrl ? json.message?.content : json.choices?.[0]?.message?.content;
        if (content) {
          console.log(`[LocalLLM] Structured response in ${Date.now() - startedAt}ms.`);
          return JSON.parse(content) as T;
        }
      } else {
        this.markOffline();
      }
    } catch (err: any) {
      console.warn(`[LocalLLM] Structured request failed after ${Date.now() - startedAt}ms: ${err instanceof Error ? err.message : String(err)}`);
      this.markOffline();
    }

    return null;
  }

  public async generateText(request: TextGenerationRequest): Promise<string | null> {
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
        headers: { 'Content-Type': 'application/json' },
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
          reasoning_effort: 'none'
        }),
        signal: AbortSignal.timeout(this.timeoutMs)
      });

      if (response.ok) {
        const json = await response.json();
        const text = (ollamaUrl ? json.message?.content : json.choices?.[0]?.message?.content)?.trim();
        if (text) {
          console.log(`[LocalLLM] Spoken response in ${Date.now() - startedAt}ms.`);
          return text;
        }
      } else {
        this.markOffline();
      }
    } catch (err: any) {
      console.warn(`[LocalLLM] Spoken request failed after ${Date.now() - startedAt}ms: ${err instanceof Error ? err.message : String(err)}`);
      this.markOffline();
    }

    return null;
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
          headers: { 'Content-Type': 'application/json' },
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
            reasoning_effort: process.env.LLM_RESEARCH_REASONING_EFFORT || 'medium',
          }),
          signal: AbortSignal.timeout(this.readPositiveInteger(process.env.LLM_RESEARCH_TIMEOUT_MS, 120_000)),
        });

        if (!response.ok) {
          const details = (await response.text().catch(() => '')).trim().slice(0, 800);
          this.markOffline();
          throw new Error(`LLM tool request returned HTTP ${response.status}${details ? `: ${details}` : ''}`);
        }

        const json = await response.json();
        const assistantMessage = ollamaUrl ? json.message : json.choices?.[0]?.message;
        const toolCalls = this.parseToolCalls(assistantMessage?.tool_calls);
        if (toolCalls.length === 0) {
          const text = typeof assistantMessage?.content === 'string' ? assistantMessage.content.trim() : '';
          return { text: text || null, calls, sources: [...sources] };
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
    const base: LocalLlmRuntimeStatus = {
      provider: ollamaUrl ? 'ollama' : 'openai-compatible',
      baseUrl: ollamaUrl || this.baseUrl,
      model: this.modelName,
      enabled: process.env.LLM_ENABLED !== 'false',
      reachable: false,
    };
    try {
      if (ollamaUrl) {
        const [versionResponse, tagsResponse] = await Promise.all([
          fetch(`${ollamaUrl}/api/version`, { signal: AbortSignal.timeout(3_000) }),
          fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3_000) }),
        ]);
        if (!versionResponse.ok || !tagsResponse.ok) throw new Error('Ollama health endpoints failed.');
        const version = await versionResponse.json();
        const tags = await tagsResponse.json();
        const installedModels = Array.isArray(tags.models)
          ? tags.models.map((model: any) => String(model.name || model.model || '')).filter(Boolean)
          : [];
        return {
          ...base,
          reachable: true,
          version: typeof version.version === 'string' ? version.version : undefined,
          installedModels,
          modelAvailable: this.hasConfiguredModel(installedModels),
        };
      }

      const response = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(3_000) });
      if (!response.ok) throw new Error(`Model endpoint returned HTTP ${response.status}`);
      const json = await response.json();
      const installedModels = Array.isArray(json.data)
        ? json.data.map((model: any) => String(model.id || '')).filter(Boolean)
        : [];
      return {
        ...base,
        reachable: true,
        installedModels,
        modelAvailable: this.hasConfiguredModel(installedModels),
      };
    } catch (error) {
      return { ...base, error: error instanceof Error ? error.message : String(error) };
    }
  }

  public async *streamText(request: TextGenerationRequest): AsyncIterable<string> {
    const text = await this.generateText(request);
    if (text) {
      // Yield words / chunks
      const words = text.split(' ');
      for (const w of words) {
        yield w + ' ';
      }
    }
  }

  public async cancel(requestId: string): Promise<void> {
    console.log(`[LocalLlmProvider] Cancelled generation request: ${requestId}`);
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

  private ollamaNativeUrl(): string | null {
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

  private parseToolCalls(value: unknown): LlmToolCall[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry: any) => {
      const name = typeof entry?.function?.name === 'string' ? entry.function.name.trim() : '';
      if (!name) return [];
      let args = entry.function.arguments;
      if (typeof args === 'string') {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
      return [{ id: typeof entry.id === 'string' ? entry.id : undefined, name, arguments: args }];
    });
  }

  private hasConfiguredModel(installedModels: string[]): boolean {
    if (installedModels.includes(this.modelName)) return true;
    if (this.modelName.includes(':')) return false;
    return installedModels.some(model => model === `${this.modelName}:latest` || model.split(':', 1)[0] === this.modelName);
  }
}

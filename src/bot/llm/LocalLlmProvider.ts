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

export class LocalLlmProvider {
  private static offlineUntil = 0;
  private baseUrl: string;
  private modelName: string;
  private timeoutMs: number;

  constructor(baseUrl?: string, modelName?: string) {
    this.baseUrl = baseUrl || process.env.LLM_BASE_URL || 'http://127.0.0.1:8080/v1';
    this.modelName = modelName || process.env.LLM_MODEL || 'qwen3:4b-instruct';
    this.timeoutMs = this.readPositiveInteger(process.env.LLM_TIMEOUT_MS, 1500);
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
          keep_alive: -1,
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
          keep_alive: -1,
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
      num_ctx: this.readPositiveInteger(process.env.LLM_CONTEXT_TOKENS, 2048),
      num_gpu: Math.max(0, Number(process.env.LLM_GPU_LAYERS || 0)),
      presence_penalty: 1.1,
    };
  }
}

import dotenv from 'dotenv';

dotenv.config();

export interface StructuredGenerationRequest {
  systemPrompt?: string;
  userPrompt: string;
  schema?: Record<string, any>;
  temperature?: number;
}

export interface TextGenerationRequest {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export class LocalLlmProvider {
  private baseUrl: string;
  private modelName: string;

  constructor(baseUrl?: string, modelName?: string) {
    this.baseUrl = baseUrl || process.env.LLM_BASE_URL || 'http://127.0.0.1:8080/v1';
    this.modelName = modelName || process.env.LLM_MODEL || 'typhoon2.5-qwen3-4b';
  }

  public async generateStructured<T>(request: StructuredGenerationRequest): Promise<T | null> {
    const messages = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.userPrompt });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages,
          temperature: request.temperature ?? 0.2,
          response_format: { type: 'json_object' }
        }),
        signal: AbortSignal.timeout(4000)
      });

      if (response.ok) {
        const json = await response.json();
        const content = json.choices?.[0]?.message?.content;
        if (content) {
          return JSON.parse(content) as T;
        }
      }
    } catch (err: any) {
      // Offline fallback: Use deterministic JSON classification engine
    }

    return null;
  }

  public async generateText(request: TextGenerationRequest): Promise<string | null> {
    const messages = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.userPrompt });

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.modelName,
          messages,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxTokens ?? 60
        }),
        signal: AbortSignal.timeout(4000)
      });

      if (response.ok) {
        const json = await response.json();
        const text = json.choices?.[0]?.message?.content?.trim();
        if (text) return text;
      }
    } catch (err: any) {
      // Offline fallback
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
}

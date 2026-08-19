import type { NightConfig } from '../night/types';
import { NIGHT_TOOL_DEFINITIONS, nightToolPrompt } from '../night/NightToolHost';
import type { CodingAttemptInput, CodingAttemptResult, CodingWorker } from './types';

type ChatMessage = Record<string, unknown>;

export class LocalQwenCodingAgent implements CodingWorker {
  readonly id: string;
  readonly kind = 'local-qwen' as const;
  private messages: ChatMessage[] = [];

  constructor(
    private readonly config: NightConfig,
    id = 'local-qwen',
  ) {
    this.id = id;
  }

  resetContext(): void {
    this.messages = [];
  }

  async attempt(input: CodingAttemptInput): Promise<CodingAttemptResult> {
    this.resetContext();
    const qwen = this.config.qwen;
    this.messages = [
      { role: 'system', content: nightToolPrompt() + '\n\n' + input.contextPacket },
      {
        role: 'user',
        content: [
          'Task ' + input.task.id + ': ' + input.task.title,
          'Goal: ' + input.task.goal,
          'Scope: ' + input.task.scope.join(', '),
          'Acceptance: ' + input.task.acceptanceCommands.join(' ; '),
          input.previousErrors.length ? 'Previous failures:\n' + input.previousErrors.join('\n') : '',
          'Inspect, patch within scope, then finish.',
        ].filter(Boolean).join('\n'),
      },
    ];

    let toolCalls = 0;
    let summary = 'no finish call';
    for (let round = 0; round < qwen.maxToolRounds; round += 1) {
      const response = await this.chat();
      if (response.providerFailure) {
        return {
          workerId: this.id,
          providerKind: this.kind,
          summary: response.providerFailure.message,
          toolCalls,
          contextReset: true,
          providerFailure: response.providerFailure,
        };
      }
      const calls = response.toolCalls;
      if (calls.length === 0) {
        summary = response.text || summary;
        break;
      }
      this.messages.push(response.assistantMessage);
      for (const call of calls) {
        toolCalls += 1;
        const result = await input.tools.execute(call.name, call.arguments);
        if (result.finished) {
          summary = result.summary || 'finished';
          return { workerId: this.id, providerKind: this.kind, summary, toolCalls, contextReset: true };
        }
        this.messages.push({
          role: 'tool',
          tool_name: call.name,
          content: result.content,
        });
      }
    }
    return { workerId: this.id, providerKind: this.kind, summary, toolCalls, contextReset: true };
  }

  private async chat(): Promise<{
    text?: string;
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
    assistantMessage: ChatMessage;
    providerFailure?: { code: 'model_unavailable' | 'provider_error'; message: string };
  }> {
    const qwen = this.config.qwen;
    let response: Response;
    try {
      response = await fetch(qwen.baseUrl.replace(/\/$/, '') + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: qwen.model,
          messages: this.messages,
          tools: NIGHT_TOOL_DEFINITIONS,
          stream: false,
          think: false,
          keep_alive: qwen.keepAlive,
          options: {
            temperature: qwen.temperature,
            num_ctx: qwen.contextTokens,
            num_predict: 900,
            num_gpu: qwen.gpuLayers,
          },
        }),
        signal: AbortSignal.timeout(qwen.timeoutMs),
      });
    } catch (error) {
      return {
        toolCalls: [],
        assistantMessage: {},
        providerFailure: { code: 'provider_error', message: error instanceof Error ? error.message : String(error) },
      };
    }
    if (!response.ok) {
      const details = (await response.text().catch(() => '')).slice(0, 400);
      const code = response.status === 404 ? 'model_unavailable' as const : 'provider_error' as const;
      return {
        toolCalls: [],
        assistantMessage: {},
        providerFailure: { code, message: 'Ollama HTTP ' + response.status + ' ' + details },
      };
    }
    const json = await response.json() as { message?: { content?: string; tool_calls?: unknown[] } };
    const assistantMessage = (json.message || {}) as ChatMessage;
    const toolCalls = parseToolCalls(json.message?.tool_calls) || parseJsonTool(json.message?.content);
    return {
      text: typeof json.message?.content === 'string' ? json.message.content : undefined,
      toolCalls,
      assistantMessage,
    };
  }
}

function parseToolCalls(value: unknown): Array<{ name: string; arguments: Record<string, unknown> }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry: any) => {
    const name = typeof entry?.function?.name === 'string' ? entry.function.name : '';
    if (!name) return [];
    let args = entry.function?.arguments;
    if (typeof args === 'string') {
      try { args = JSON.parse(args); } catch { args = {}; }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) args = {};
    return [{ name, arguments: args as Record<string, unknown> }];
  });
}

function parseJsonTool(content: unknown): Array<{ name: string; arguments: Record<string, unknown> }> {
  if (typeof content !== 'string') return [];
  const trimmed = content.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    if (parsed.action === 'finish') {
      return [{ name: 'finish', arguments: { summary: String(parsed.summary || parsed.content || '') } }];
    }
    const name = String(parsed.name || parsed.tool || '');
    if (!name) return [];
    const args = parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments)
      ? parsed.arguments as Record<string, unknown>
      : parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
        ? parsed.args as Record<string, unknown>
        : {};
    return [{ name, arguments: args }];
  } catch {
    return [];
  }
}
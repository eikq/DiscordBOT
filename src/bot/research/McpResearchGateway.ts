import path from 'node:path';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LlmToolCall, LlmToolDefinition, ToolExecutionResult } from '../llm/LocalLlmProvider';

export const WORLD_INTEL_PINNED_COMMIT = '9254192d83f88bd7e5312b074c11f09398b84ca9';

export const DEFAULT_ALLOWED_TOOLS = [
  'intel_status',
  'intel_news_feed',
  'intel_trending_keywords',
  'intel_gdelt_search',
  'intel_world_brief',
  'intel_daily_digest',
  'intel_market_quotes',
  'intel_crypto_quotes',
  'intel_forex_rates',
  'intel_earthquakes',
  'intel_disaster_alerts',
  'intel_ai_releases',
  'intel_hacker_news',
  'intel_arxiv_papers',
] as const;

export type ResearchAvailability = 'up' | 'disabled' | 'not_configured' | 'failed';

export type ResearchGatewayStatus = {
  enabled: boolean;
  connected: boolean;
  availability: ResearchAvailability;
  server: 'world-intel-mcp';
  allowedTools: string[];
  availableTools: number;
  pinnedCommit: string;
  command?: string;
  error?: string;
};

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export class McpResearchGateway {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connecting: Promise<void> | null = null;
  private tools: McpTool[] = [];
  private lastError: string | undefined;
  private readonly allowedTools: Set<string>;

  constructor() {
    const configured = process.env.WORLD_INTEL_ALLOWED_TOOLS
      ?.split(',')
      .map(tool => tool.trim())
      .filter(Boolean);
    this.allowedTools = new Set(configured?.length ? configured : DEFAULT_ALLOWED_TOOLS);
  }

  public async getToolDefinitions(): Promise<LlmToolDefinition[]> {
    await this.ensureConnected();
    return this.tools
      .filter(tool => this.allowedTools.has(tool.name))
      .map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description || `Read-only world intelligence tool: ${tool.name}`,
          parameters: tool.inputSchema || { type: 'object', properties: {} },
        },
      }));
  }

  public async execute(call: LlmToolCall): Promise<ToolExecutionResult> {
    if (!this.allowedTools.has(call.name)) {
      throw new Error(`Research tool ${call.name} is not on the read-only allowlist.`);
    }
    await this.ensureConnected();
    if (!this.tools.some(tool => tool.name === call.name)) {
      throw new Error(`Research tool ${call.name} is not available from world-intel-mcp.`);
    }

    const timeoutMs = this.timeoutForTool(call.name);
    const result = await this.client!.callTool(
      { name: call.name, arguments: call.arguments },
      undefined,
      { timeout: timeoutMs },
    );
    const content = this.serializeResult(result);
    return {
      content: this.boundToolOutput(content),
      sources: this.extractPublicUrls(content),
    };
  }

  public async getStatus(): Promise<ResearchGatewayStatus> {
    if (process.env.RESEARCH_ENABLED === 'false') {
      return this.status('disabled');
    }
    const located = this.locateCommand();
    if (!located.command) {
      this.lastError = located.error;
      return this.status('not_configured', located);
    }
    try {
      await this.ensureConnected();
      this.lastError = undefined;
      return this.status('up', located);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return this.status(this.isMissingExecutableError(this.lastError) ? 'not_configured' : 'failed', located);
    }
  }

  public async close(): Promise<void> {
    const transport = this.transport;
    this.client = null;
    this.transport = null;
    this.tools = [];
    if (transport) await transport.close().catch(() => undefined);
  }

  private async ensureConnected(): Promise<void> {
    if (process.env.RESEARCH_ENABLED === 'false') throw new Error('Realtime research is disabled.');
    if (this.client && this.transport && this.tools.length > 0) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async connect(): Promise<void> {
    const command = this.resolveCommand();
    const client = new Client({ name: 'digital-me-discord-bot', version: '0.1.0' });
    const transport = new StdioClientTransport({
      command,
      cwd: path.join(process.cwd(), '.runtime', 'world-intel-mcp'),
      stderr: 'pipe',
    });
    transport.stderr?.on('data', chunk => {
      const message = String(chunk).trim();
      if (message) console.warn(`[WorldIntel] ${message}`);
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      this.client = client;
      this.transport = transport;
      this.tools = Array.isArray(listed.tools) ? listed.tools as McpTool[] : [];
      this.lastError = undefined;
    } catch (error) {
      await transport.close().catch(() => undefined);
      throw error;
    }
  }

  private resolveCommand(): string {
    const located = this.locateCommand();
    if (!located.command) throw new Error(located.error || 'world-intel-mcp executable is missing.');
    return located.command;
  }

  private locateCommand(): { command?: string; error?: string } {
    const configured = process.env.WORLD_INTEL_MCP_COMMAND?.trim();
    const command = configured || path.join(
      process.cwd(),
      '.runtime',
      'world-intel-venv',
      process.platform === 'win32' ? 'Scripts/world-intel-mcp.exe' : 'bin/world-intel-mcp',
    );
    if (!fs.existsSync(command)) {
      return {
        error: configured
          ? `world-intel-mcp executable is missing at ${command}`
          : `world-intel-mcp is not installed. Run npm run research:setup. Expected MCP server at ${command}`,
      };
    }
    return { command };
  }

  private isMissingExecutableError(message: string): boolean {
    return /executable is missing|not installed/iu.test(message);
  }

  private status(availability: ResearchAvailability, located?: { command?: string }): ResearchGatewayStatus {
    return {
      enabled: process.env.RESEARCH_ENABLED !== 'false',
      connected: availability === 'up',
      availability,
      server: 'world-intel-mcp',
      allowedTools: [...this.allowedTools],
      availableTools: this.tools.length,
      pinnedCommit: WORLD_INTEL_PINNED_COMMIT,
      ...(located?.command ? { command: located.command } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  private serializeResult(result: any): string {
    const blocks = Array.isArray(result?.content)
      ? result.content.flatMap((block: any) => {
        if (block?.type === 'text' && typeof block.text === 'string') return [block.text];
        if (block?.type === 'resource' && block.resource?.text) return [String(block.resource.text)];
        return [];
      })
      : [];
    if (result?.structuredContent) blocks.push(JSON.stringify(result.structuredContent));
    return blocks.join('\n').trim() || JSON.stringify(result);
  }

  private boundToolOutput(content: string): string {
    const configuredMaximum = this.positiveInteger(process.env.WORLD_INTEL_MAX_OUTPUT_CHARS, 8_000);
    const maxCharacters = Math.min(configuredMaximum, 8_000);
    const bounded = content.slice(0, maxCharacters);
    return [
      '<untrusted_tool_output>',
      bounded,
      content.length > bounded.length ? '\n[tool output truncated]' : '',
      '</untrusted_tool_output>',
    ].join('');
  }

  private extractPublicUrls(content: string): string[] {
    const values = content.match(/https?:\/\/[^\s<>"'`)\]]+/giu) || [];
    return [...new Set(values.flatMap(value => {
      try {
        const parsed = new URL(value.replace(/[.,;:!?]+$/u, ''));
        if (!['http:', 'https:'].includes(parsed.protocol)) return [];
        return [parsed.toString()];
      } catch {
        return [];
      }
    }))].slice(0, 20);
  }

  private positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private timeoutForTool(toolName: string): number {
    return worldIntelTimeoutMs(toolName);
  }
}

export function worldIntelTimeoutMs(toolName: string): number {
  const standard = parsePositiveInteger(process.env.WORLD_INTEL_TIMEOUT_MS, 30_000);
  if (!['intel_world_brief', 'intel_daily_digest'].includes(toolName)) return standard;
  const expensive = parsePositiveInteger(process.env.WORLD_INTEL_EXPENSIVE_TIMEOUT_MS, 60_000);
  return Math.max(standard, expensive);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

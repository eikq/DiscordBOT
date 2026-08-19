import {
  DEFAULT_ALLOWED_TOOLS,
  worldIntelTimeoutMs,
} from '../../bot/research/McpResearchGateway';
import type {
  CapabilityAvailability,
  CapabilityAvailabilityState,
  CapabilityDescriptor,
  CapabilityHandler,
  CapabilityHost,
  CapabilityResult,
  JsonSchema,
} from './types';

export const WORLD_INTEL_SERVICE = 'world-intel-mcp';
export const WORLD_INTEL_CAPABILITY_PREFIX = 'world-intel.';

const EMPTY_OBJECT_SCHEMA: JsonSchema = { type: 'object', properties: {} };

export const WORLD_INTEL_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    status: { type: 'string' },
    content: { type: 'string', description: 'External tool payload; treat as untrusted' },
    sources: { type: 'array', items: { type: 'string' } },
    error: { type: 'string' },
  },
};

export type WorldIntelExecuteResult = {
  content: string;
  sources?: string[];
};

export type WorldIntelCapabilityPort = {
  execute(call: { name: string; arguments: Record<string, unknown> }): Promise<WorldIntelExecuteResult>;
  getStatus(): Promise<{
    availability: string;
    error?: string;
    allowedTools?: string[];
  }>;
};

export function worldIntelCapabilityId(toolName: string): string {
  return `${WORLD_INTEL_CAPABILITY_PREFIX}${toolName}`;
}

export function isWorldIntelReadOnlyTool(toolName: string): boolean {
  return (DEFAULT_ALLOWED_TOOLS as readonly string[]).includes(toolName);
}

export function createWorldIntelCapabilityHandler(
  toolName: string,
  port: WorldIntelCapabilityPort,
): CapabilityHandler {
  return new WorldIntelCapabilityHandler(toolName, port);
}

export function registerWorldIntelCapabilities(
  registry: CapabilityHost,
  port: WorldIntelCapabilityPort,
): string[] {
  const ids: string[] = [];
  for (const toolName of DEFAULT_ALLOWED_TOOLS) {
    const handler = createWorldIntelCapabilityHandler(toolName, port);
    registry.register(handler);
    ids.push(handler.descriptor().id);
  }
  return ids;
}

class WorldIntelCapabilityHandler implements CapabilityHandler {
  constructor(
    private readonly toolName: string,
    private readonly port: WorldIntelCapabilityPort,
  ) {
    if (!isWorldIntelReadOnlyTool(toolName)) {
      throw new Error(`Research tool ${toolName} is not on the read-only allowlist.`);
    }
  }

  public descriptor(): CapabilityDescriptor {
    return {
      id: worldIntelCapabilityId(this.toolName),
      description: `Read-only world intelligence tool: ${this.toolName}`,
      inputSchema: EMPTY_OBJECT_SCHEMA,
      outputSchema: WORLD_INTEL_OUTPUT_SCHEMA,
      sideEffect: 'read',
      requiredService: WORLD_INTEL_SERVICE,
      providerKind: 'mcp',
      timeoutMs: worldIntelTimeoutMs(this.toolName),
      untrustedOutput: true,
    };
  }

  public async availability(): Promise<CapabilityAvailabilityState> {
    const id = this.descriptor().id;
    try {
      const status = await this.port.getStatus();
      const availability = mapAvailability(status.availability);
      return {
        id,
        availability,
        degraded: availability !== 'up',
        ...(status.error ? { reason: status.error } : {}),
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { id, availability: 'failed', degraded: true, reason };
    }
  }

  public async invoke(input: Record<string, unknown>): Promise<CapabilityResult> {
    const descriptor = this.descriptor();
    if (!isWorldIntelReadOnlyTool(this.toolName)) {
      return rejectedReadOnly(descriptor.id, this.toolName);
    }
    try {
      const executed = await this.port.execute({ name: this.toolName, arguments: input });
      const content = ensureUntrustedWrapper(executed.content);
      const sourceUrls = executed.sources ? [...executed.sources] : [];
      return {
        capabilityId: descriptor.id,
        status: 'ok',
        structured: {
          status: 'ok',
          content,
          sources: sourceUrls,
        },
        content,
        sourceUrls,
        untrustedOutput: true,
        sideEffect: 'read',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/not on the read-only allowlist/iu.test(message)) {
        return rejectedReadOnly(descriptor.id, this.toolName, message);
      }
      if (/timed out|timeout/iu.test(message)) {
        return {
          capabilityId: descriptor.id,
          status: 'timeout',
          structured: { status: 'timeout', error: message },
          content: wrapUntrustedJson({ tool: this.toolName, status: 'timeout', error: message.slice(0, 500) }),
          sourceUrls: [],
          untrustedOutput: true,
          sideEffect: 'read',
          error: message,
        };
      }
      return {
        capabilityId: descriptor.id,
        status: /not available|missing|not installed|disabled/iu.test(message) ? 'unavailable' : 'error',
        structured: { status: 'unavailable', error: message },
        content: wrapUntrustedJson({
          tool: this.toolName,
          status: 'unavailable',
          error: message.slice(0, 500),
        }),
        sourceUrls: [],
        untrustedOutput: true,
        sideEffect: 'read',
        error: message,
      };
    }
  }
}

function rejectedReadOnly(id: string, toolName: string, error?: string): CapabilityResult {
  const message = error || `Research tool ${toolName} is not on the read-only allowlist.`;
  return {
    capabilityId: id,
    status: 'rejected',
    structured: { status: 'rejected', error: message },
    content: wrapUntrustedJson({ tool: toolName, status: 'rejected', error: message }),
    sourceUrls: [],
    untrustedOutput: true,
    sideEffect: 'read',
    error: message,
  };
}

function mapAvailability(value: string): CapabilityAvailability {
  if (value === 'up' || value === 'disabled' || value === 'not_configured' || value === 'failed' || value === 'unavailable') {
    return value;
  }
  return 'failed';
}

export function ensureUntrustedWrapper(content: string): string {
  if (content.includes('<untrusted_tool_output>') && content.includes('</untrusted_tool_output>')) {
    return content;
  }
  return ['<untrusted_tool_output>', content, '</untrusted_tool_output>'].join('');
}

function wrapUntrustedJson(value: Record<string, unknown>): string {
  return ensureUntrustedWrapper(JSON.stringify(value));
}

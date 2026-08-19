import type { CapabilityHandler, CapabilityResult } from './types';

export const LAB_PING_CAPABILITY_ID = 'lab.ping';

export function createLabPingHandler(): CapabilityHandler {
  return {
    descriptor: () => ({
      id: LAB_PING_CAPABILITY_ID,
      description: 'Local Jarvis lab ping. Does not call MCP or mutate state.',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { ok: { type: 'boolean' }, content: { type: 'string' } } },
      sideEffect: 'read',
      requiredService: 'jarvis-lab',
      providerKind: 'local',
      timeoutMs: 1_000,
      untrustedOutput: false,
    }),
    availability: async () => ({ id: LAB_PING_CAPABILITY_ID, availability: 'up' as const, degraded: false }),
    invoke: async (): Promise<CapabilityResult> => ({
      capabilityId: LAB_PING_CAPABILITY_ID,
      status: 'ok',
      structured: { ok: true, content: 'pong' },
      content: 'pong',
      sourceUrls: [],
      untrustedOutput: false,
      sideEffect: 'read',
    }),
  };
}

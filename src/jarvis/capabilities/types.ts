/**
 * Client-neutral capability metadata and results.
 *
 * Jarvis Core depends on these types, not on MCP/HTTP/local providers.
 * Presentation code must not invoke capabilities.
 */

export type JsonSchema = Record<string, unknown>;

/** Side-effect class for policy/routing. Write classes exist for later JF-010. */
export type CapabilitySideEffect = 'read' | 'write';

export type CapabilityProviderKind = 'mcp' | 'http' | 'local' | 'other';

export type CapabilityAvailability =
  | 'up'
  | 'disabled'
  | 'not_configured'
  | 'failed'
  | 'unavailable';

export type CapabilityInvokeStatus =
  | 'ok'
  | 'unavailable'
  | 'timeout'
  | 'error'
  | 'rejected'
  | 'confirmation_required';

export interface CapabilityDescriptor {
  id: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  sideEffect: CapabilitySideEffect;
  requiredService: string;
  providerKind: CapabilityProviderKind;
  timeoutMs: number;
  untrustedOutput: boolean;
}

export interface CapabilityAvailabilityState {
  id: string;
  availability: CapabilityAvailability;
  degraded: boolean;
  reason?: string;
}

export interface CapabilityInvokeRequest {
  id: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
  confirmation?: {
    proposalId: string;
    token: string;
  };
  source?: 'text' | 'voice' | 'ui' | 'system';
  sessionId?: string;
  requestId?: string;
}

export interface CapabilityResult {
  capabilityId: string;
  status: CapabilityInvokeStatus;
  structured: Record<string, unknown>;
  content: string;
  sourceUrls: string[];
  untrustedOutput: boolean;
  sideEffect: CapabilitySideEffect;
  error?: string;
}

export interface CapabilityHandler {
  descriptor(): CapabilityDescriptor;
  availability(): Promise<CapabilityAvailabilityState>;
  invoke(input: Record<string, unknown>): Promise<CapabilityResult>;
}

export interface CapabilityHost {
  register(handler: CapabilityHandler): void;
  lookup(id: string): CapabilityDescriptor | undefined;
  list(): CapabilityDescriptor[];
  availability(id: string): Promise<CapabilityAvailabilityState>;
  invoke(request: CapabilityInvokeRequest): Promise<CapabilityResult>;
}

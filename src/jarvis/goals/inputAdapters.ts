import type { CapabilityDescriptor, CapabilityHost } from '../capabilities/types';
import { RESEARCH_CURRENT, RESEARCH_PRIVATE_BROWSE, RESEARCH_SEARCH } from '../research/constants';
import { WORKSPACE_CURRENT, WORKSPACE_SEARCH } from '../workspace/constants';
import {
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_OPEN_TRUSTED_URL,
  JARVIS_RUNTIME_STATUS,
  SYSTEM_STATUS,
} from '../capabilities/actions/constants';
import { REMINDERS_CREATE } from '../automation/constants';
import type { InputCompatibility } from './types';
import { validateAdapterAuthorityBoundary, validateAgainstJsonSchema } from './schema';

export type TrustedAdapterContext = {
  trustedWorkspaceId?: string;
};

export type TrustedInputAdapterDefinition = {
  id: string;
  capabilityId: string;
  acceptedGoalFields: string[];
  adapt: (input: Readonly<Record<string, unknown>>, context: Readonly<TrustedAdapterContext>) => Record<string, unknown>;
};

export type AdaptedCapabilityInput = {
  compatibility: InputCompatibility;
  input: Record<string, unknown>;
  adapterId?: string;
  issues: string[];
  evidence: string[];
};

export class TrustedInputAdapterRegistry {
  private readonly adapters = new Map<string, TrustedInputAdapterDefinition>();

  public register(definition: TrustedInputAdapterDefinition): void {
    if (!definition.id.trim() || !definition.capabilityId.trim()) throw new Error('Trusted input adapter requires id and capabilityId.');
    if (this.adapters.has(definition.id)) throw new Error(`Trusted input adapter ${definition.id} is already registered.`);
    this.adapters.set(definition.id, { ...definition, acceptedGoalFields: [...definition.acceptedGoalFields] });
  }

  public get(id: string): TrustedInputAdapterDefinition | undefined {
    const item = this.adapters.get(id);
    return item ? { ...item, acceptedGoalFields: [...item.acceptedGoalFields] } : undefined;
  }

  public run(input: {
    adapterId: string;
    capabilityId: string;
    goalInput: Record<string, unknown>;
    host: CapabilityHost;
    context?: TrustedAdapterContext;
  }): AdaptedCapabilityInput {
    const adapter = this.adapters.get(input.adapterId);
    if (!adapter || adapter.capabilityId !== input.capabilityId) {
      return incompatible('UNKNOWN', {}, ['The catalog route does not reference a registered trusted adapter.']);
    }
    const unexpected = Object.keys(input.goalInput).filter(key => !adapter.acceptedGoalFields.includes(key));
    if (unexpected.length) return incompatible('INCOMPATIBLE', {}, unexpected.map(key => `Goal field ${key} is not accepted by ${adapter.id}.`));
    const authority = validateAdapterAuthorityBoundary(input.goalInput);
    if (authority.ok === false) return incompatible('INCOMPATIBLE', {}, authority.issues);
    let adapted: Record<string, unknown>;
    try {
      adapted = adapter.adapt(Object.freeze(structuredClone(input.goalInput)), Object.freeze({ ...(input.context ?? {}) }));
    } catch (error) {
      return incompatible('INCOMPATIBLE', {}, [error instanceof Error ? error.message : 'The trusted adapter rejected the input.']);
    }
    const outputAuthority = validateAdapterAuthorityBoundary(adapted);
    if (outputAuthority.ok === false) return incompatible('INCOMPATIBLE', {}, outputAuthority.issues);
    const descriptor = input.host.lookup(input.capabilityId);
    if (!descriptor) return incompatible('UNKNOWN', {}, [`Capability ${input.capabilityId} is not registered.`]);
    const schema = validateAgainstJsonSchema(adapted, descriptor.inputSchema);
    if (schema.ok === false) return incompatible('INCOMPATIBLE', adapted, schema.issues);
    return {
      compatibility: 'ADAPTER_COMPATIBLE',
      input: adapted,
      adapterId: adapter.id,
      issues: [],
      evidence: [`adapter:${adapter.id}`, `schema:${descriptor.id}`],
    };
  }
}

export function directCapabilityInput(
  descriptor: CapabilityDescriptor | undefined,
  input: Record<string, unknown>,
): AdaptedCapabilityInput {
  if (!descriptor) return incompatible('UNKNOWN', {}, ['The capability descriptor is unavailable.']);
  const authority = validateAdapterAuthorityBoundary(input);
  if (authority.ok === false) return incompatible('INCOMPATIBLE', {}, authority.issues);
  const schema = validateAgainstJsonSchema(input, descriptor.inputSchema);
  if (schema.ok === false) return incompatible('INCOMPATIBLE', input, schema.issues);
  return {
    compatibility: 'DIRECT_COMPATIBLE',
    input: structuredClone(input),
    issues: [],
    evidence: [`direct-schema:${descriptor.id}`],
  };
}

export function createDefaultInputAdapterRegistry(): TrustedInputAdapterRegistry {
  const registry = new TrustedInputAdapterRegistry();
  registry.register({
    id: 'research.current.query.v1',
    capabilityId: RESEARCH_CURRENT,
    acceptedGoalFields: ['query', 'officialOnly', 'freshness', 'compare', 'scope'],
    adapt: input => ({
      query: boundedString(input.query, 'query', 200),
      officialOnly: Boolean(input.officialOnly),
      freshness: input.freshness === 'latest' ? 'latest' : 'any',
      compare: Boolean(input.compare),
    }),
  });
  registry.register({
    id: 'research.search.query.v1',
    capabilityId: RESEARCH_SEARCH,
    acceptedGoalFields: ['query', 'officialOnly', 'freshness', 'compare', 'scope'],
    adapt: input => ({
      query: boundedString(input.query, 'query', 200),
      maxResults: 6,
      freshness: input.freshness === 'latest' ? 'latest' : 'any',
      ...(input.officialOnly ? { officialOnly: true } : {}),
    }),
  });
  registry.register({
    id: 'research.private.query.v1',
    capabilityId: RESEARCH_PRIVATE_BROWSE,
    acceptedGoalFields: ['query', 'officialOnly', 'freshness', 'compare', 'scope'],
    adapt: input => ({ query: boundedString(input.query, 'query', 200), depth: 'standard' }),
  });
  registry.register({
    id: 'workspace.search.query.v1',
    capabilityId: WORKSPACE_SEARCH,
    acceptedGoalFields: ['query', 'scope'],
    adapt: (input, context) => ({
      query: boundedString(input.query, 'query', 200),
      ...(context.trustedWorkspaceId ? { workspaceId: context.trustedWorkspaceId } : {}),
    }),
  });
  registry.register({
    id: 'workspace.current.query.v1',
    capabilityId: WORKSPACE_CURRENT,
    acceptedGoalFields: ['query', 'documentId', 'mode'],
    adapt: (input, context) => ({
      ...(typeof input.query === 'string' && input.query.trim() ? { query: input.query.trim().slice(0, 200) } : {}),
      ...(typeof input.documentId === 'string' && input.documentId.trim() ? { documentId: input.documentId.trim() } : {}),
      mode: input.mode === 'summarize' ? 'summarize' : 'auto',
      ...(context.trustedWorkspaceId ? { workspaceId: context.trustedWorkspaceId } : {}),
    }),
  });
  registry.register({
    id: 'reminders.create.text.v1',
    capabilityId: REMINDERS_CREATE,
    acceptedGoalFields: ['whenText', 'title', 'message'],
    adapt: input => ({
      whenText: boundedString(input.whenText, 'whenText', 400),
      title: boundedString(input.title, 'title', 200),
      ...(typeof input.message === 'string' && input.message.trim() ? { message: input.message.trim().slice(0, 500) } : {}),
    }),
  });
  registry.register({
    id: 'desktop.scoped.v1',
    capabilityId: DESKTOP_OPEN_SCOPED_RESOURCE,
    acceptedGoalFields: ['resource', 'display', 'applicationId', 'url', 'kind', 'label'],
    adapt: input => {
      const resource = input.resource && typeof input.resource === 'object' ? input.resource as Record<string, unknown> : {};
      const kind = resource.kind === 'url' || input.kind === 'url' || resource.url || input.url ? 'url' : 'application';
      return {
        kind,
        ...(typeof resource.applicationId === 'string' ? { applicationId: resource.applicationId } : {}),
        ...(typeof resource.url === 'string' ? { url: resource.url } : {}),
        ...(typeof resource.label === 'string' ? { label: resource.label } : {}),
        ...(input.display && typeof input.display === 'object' ? { display: input.display } : {}),
      };
    },
  });
  registry.register({
    id: 'desktop.app.v1',
    capabilityId: DESKTOP_OPEN_APPLICATION,
    acceptedGoalFields: ['resource', 'applicationId', 'display'],
    adapt: input => {
      const resource = input.resource && typeof input.resource === 'object' ? input.resource as { applicationId?: string } : {};
      return { applicationId: boundedString(resource.applicationId || input.applicationId, 'applicationId', 32) };
    },
  });
  registry.register({
    id: 'desktop.url.v1',
    capabilityId: DESKTOP_OPEN_TRUSTED_URL,
    acceptedGoalFields: ['resource', 'url', 'display'],
    adapt: input => {
      const resource = input.resource && typeof input.resource === 'object' ? input.resource as { url?: string } : {};
      return { url: boundedString(resource.url || input.url, 'url', 500) };
    },
  });
  for (const capabilityId of [JARVIS_RUNTIME_STATUS, SYSTEM_STATUS]) {
    registry.register({
      id: `${capabilityId}.empty.v1`,
      capabilityId,
      acceptedGoalFields: [],
      adapt: () => ({}),
    });
  }
  return registry;
}

function boundedString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim().slice(0, max);
}

function incompatible(
  compatibility: Extract<InputCompatibility, 'INCOMPATIBLE' | 'UNKNOWN'>,
  input: Record<string, unknown>,
  issues: string[],
): AdaptedCapabilityInput {
  return { compatibility, input, issues, evidence: [] };
}

import { defaultBuildRoot } from '../build/sandbox';
import {
  createStandaloneCapabilityHost,
  type StandaloneCapabilityHostOptions,
} from '../capabilities/standaloneHost';
import type {
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvokeRequest,
  CapabilityResult,
} from '../capabilities/types';
import { defaultConversationStatePath } from '../conversation/store';
import { McpMediaGateway } from '../media';
import { isCommunityCapabilityAllowed, jarvisEditionManifest, communityUnavailablePrivateText } from './manifest';
import { ensureJarvisDataRoot, isCommunityEdition, resolveJarvisEdition } from './resolve';

function rejectCommunityCapability(id: string): CapabilityResult {
  return {
    capabilityId: id,
    status: 'rejected',
    structured: { edition: 'community', excluded: true },
    content: communityUnavailablePrivateText(),
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'read',
    error: 'COMMUNITY_EXCLUDED',
  };
}

export function guardCommunityHost(host: CapabilityHost): CapabilityHost {
  return new Proxy(host, {
    get(target, prop, receiver) {
      if (prop === 'list') {
        return () => target.list().filter(item => isCommunityCapabilityAllowed(item.id));
      }
      if (prop === 'lookup') {
        return (id: string) => (isCommunityCapabilityAllowed(id) ? target.lookup(id) : undefined);
      }
      if (prop === 'availability') {
        return async (id: string) => {
          if (!isCommunityCapabilityAllowed(id)) {
            return { id, availability: 'disabled' as const, degraded: false, reason: 'COMMUNITY_EXCLUDED' };
          }
          return target.availability(id);
        };
      }
      if (prop === 'invoke') {
        return async (request: CapabilityInvokeRequest) => {
          if (!isCommunityCapabilityAllowed(request.id)) return rejectCommunityCapability(request.id);
          return target.invoke(request);
        };
      }
      if (prop === 'register') {
        return (handler: CapabilityHandler) => {
          if (!isCommunityCapabilityAllowed(handler.descriptor().id)) return;
          return target.register(handler);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

export function createEditionCapabilityHost(
  options: StandaloneCapabilityHostOptions = {},
): CapabilityHost {
  if (!isCommunityEdition()) {
    const media = options.media === false
      ? false
      : options.media ?? { port: new McpMediaGateway() };
    return createStandaloneCapabilityHost({ ...options, media });
  }
  const research = options.research === false
    ? false
    : { ...(options.research || {}), privateGateway: false as const };
  const build = options.build === false
    ? false
    : { ...(options.build || {}), sandboxRoot: options.build?.sandboxRoot || defaultBuildRoot() };
  return guardCommunityHost(createStandaloneCapabilityHost({
    ...options,
    worldIntel: false,
    research,
    build,
    desktop: false,
  }));
}

export function communityRuntimePaths(workspaceRoot = process.cwd()) {
  const root = ensureJarvisDataRoot(workspaceRoot);
  return {
    dataRoot: root,
    conversationState: defaultConversationStatePath(workspaceRoot),
    sandboxRoot: defaultBuildRoot(),
    manifest: jarvisEditionManifest(resolveJarvisEdition()),
  };
}

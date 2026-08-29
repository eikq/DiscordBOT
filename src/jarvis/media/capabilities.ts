import type {
  CapabilityAvailabilityState,
  CapabilityHandler,
  CapabilityHost,
  CapabilityInvocationContext,
  CapabilityResult,
} from '../capabilities/types';
import type { ActionEffectTemplate } from '../safety/types';
import {
  MEDIA_CANCEL,
  MEDIA_CREATE_VIDEO,
  MEDIA_GET_OUTPUT,
  MEDIA_STATUS,
} from './constants';
import type { MediaCapabilityPort, MediaCreateRequest } from './gateway';

export type MediaCapabilityDeps = {
  port: MediaCapabilityPort;
};

export function registerMediaCapabilities(host: CapabilityHost, deps: MediaCapabilityDeps): void {
  host.register(createVideoHandler(deps));
  host.register(statusHandler(deps));
  host.register(cancelHandler(deps));
  host.register(outputHandler(deps));
}

function createVideoHandler(deps: MediaCapabilityDeps): CapabilityHandler {
  return mediaHandler({
    id: MEDIA_CREATE_VIDEO,
    description: 'Create and queue a local multi-shot video project from an owner storyline.',
    sideEffect: 'write',
    timeoutMs: 180_000,
    cancellation: true,
    effects: [
      {
        kind: 'CREATE',
        description: 'Create bounded media project metadata and prepared workflow files in the shared AI Media Bridge workspace.',
        destructive: false, reversible: true, privilege: 'standard_user',
        targets: ['AI Media Bridge project workspace'], estimatedAffectedObjects: 1,
        massChangePolicy: 'bounded_generated_output',
      },
      {
        kind: 'CREATE',
        description: 'Queue bounded local ComfyUI render jobs; paid/cloud execution is disabled on this capability.',
        destructive: false, reversible: true, privilege: 'standard_user',
        targets: ['local ComfyUI render queue'], countInputField: 'shotCount',
        massChangePolicy: 'bounded_generated_output',
      },
    ],
    invoke: async (input, context) => {
      const request: MediaCreateRequest = {
        storyline: String(input.storyline),
        ...(input.title ? { title: String(input.title) } : {}),
        ...(input.targetDurationSeconds ? { targetDurationSeconds: Number(input.targetDurationSeconds) } : {}),
        ...(input.aspectRatio ? { aspectRatio: String(input.aspectRatio) } : {}),
        ...(input.style ? { style: String(input.style) } : {}),
        ...(input.fps ? { fps: Number(input.fps) } : {}),
        ...(input.shotCount ? { shotCount: Number(input.shotCount) } : {}),
      };
      const submitted = await deps.port.createVideo(request, context?.signal);
      return ok(MEDIA_CREATE_VIDEO, `Queued ${submitted.jobs.length} local video shot(s).`, {
        status: 'queued', ...submitted,
      }, 'write');
    },
    availability: () => availability(deps.port, true, MEDIA_CREATE_VIDEO),
  });
}

function statusHandler(deps: MediaCapabilityDeps): CapabilityHandler {
  return mediaHandler({
    id: MEDIA_STATUS,
    description: 'Read shared render/job status for one media project.',
    sideEffect: 'read',
    timeoutMs: 45_000,
    invoke: async input => {
      const state = await deps.port.status(String(input.projectId));
      return ok(MEDIA_STATUS, mediaStatusSummary(state), state, 'read');
    },
    availability: () => availability(deps.port, false, MEDIA_STATUS),
  });
}

function cancelHandler(deps: MediaCapabilityDeps): CapabilityHandler {
  return mediaHandler({
    id: MEDIA_CANCEL,
    description: 'Cancel queued/running ComfyUI jobs owned by one media project.',
    sideEffect: 'write',
    timeoutMs: 60_000,
    effects: [{
      kind: 'DATA_CHANGE',
      description: 'Mark and cancel only jobs already owned by the specified media project.',
      destructive: false, reversible: false, privilege: 'standard_user',
      targetInputFields: ['projectId'], estimatedAffectedObjects: 1,
      massChangePolicy: 'bounded_generated_output',
    }],
    invoke: async input => {
      const result = await deps.port.cancel(String(input.projectId));
      const count = Array.isArray(result.cancelled) ? result.cancelled.length : 0;
      return ok(MEDIA_CANCEL, `Cancelled ${count} media job(s).`, result, 'write');
    },
    availability: () => availability(deps.port, false, MEDIA_CANCEL),
  });
}

function outputHandler(deps: MediaCapabilityDeps): CapabilityHandler {
  return mediaHandler({
    id: MEDIA_GET_OUTPUT,
    description: 'Collect completed media outputs into the shared project and optionally stitch final.mp4.',
    sideEffect: 'write',
    timeoutMs: 360_000,
    effects: [{
      kind: 'CREATE',
      description: 'Copy completed outputs and optionally create final.mp4 inside the bounded media project.',
      destructive: false, reversible: true, privilege: 'standard_user',
      targetInputFields: ['projectId'], estimatedAffectedObjects: 25,
      massChangePolicy: 'bounded_generated_output',
    }],
    invoke: async input => {
      const result = await deps.port.collectOutput(String(input.projectId), input.stitch !== false);
      const finalVideo = typeof result.final_video === 'string' ? result.final_video : '';
      return ok(
        MEDIA_GET_OUTPUT,
        finalVideo ? `Final video ready: ${finalVideo}` : 'Collected available media outputs.',
        result,
        'write',
      );
    },
    availability: () => availability(deps.port, false, MEDIA_GET_OUTPUT),
  });
}

type MediaHandlerOptions = {
  id: string;
  description: string;
  sideEffect: 'read' | 'write';
  timeoutMs: number;
  cancellation?: boolean;
  effects?: ActionEffectTemplate[];
  availability: () => Promise<CapabilityAvailabilityState>;
  invoke: (input: Record<string, unknown>, context?: CapabilityInvocationContext) => Promise<CapabilityResult>;
};

function mediaHandler(options: MediaHandlerOptions): CapabilityHandler {
  return {
    descriptor: () => ({
      id: options.id,
      description: options.description,
      inputSchema: mediaInputSchema(options.id),
      outputSchema: { type: 'object' },
      sideEffect: options.sideEffect,
      requiredService: 'ai-media-bridge',
      providerKind: 'mcp',
      timeoutMs: options.timeoutMs,
      untrustedOutput: false,
      ...(options.effects ? { effects: options.effects } : {}),
      ...(options.cancellation ? { cancellation: { support: 'cooperative' as const } } : {}),
      intelligence: {
        maturity: 'REAL',
        executionMode: 'REAL',
        permission: options.sideEffect === 'read' ? 'NOT_REQUIRED' : 'POLICY_EVALUATED',
        distribution: ['OWNER_ONLY', 'COMMUNITY_EXCLUDED', 'DEMO_EXCLUDED'],
        requirements: {
          services: ['ai-media-bridge', 'comfy-mcp', 'ComfyUI'],
          dependencies: ['local GPU backend', 'registered media workflow'],
        },
        knownLimitations: ['Local-only by default', 'No paid/cloud generation without a separate owner-authorized path'],
      },
    }),
    availability: options.availability,
    invoke: async (input, context) => {
      try {
        return await options.invoke(input, context);
      } catch (error) {
        return mediaFailure(options.id, options.sideEffect, error);
      }
    },
  };
}

function mediaInputSchema(id: string): Record<string, unknown> {
  if (id === MEDIA_CREATE_VIDEO) {
    return {
      type: 'object', additionalProperties: false, required: ['storyline'],
      properties: {
        storyline: { type: 'string', minLength: 1, maxLength: 12000 },
        title: { type: 'string', minLength: 1, maxLength: 120 },
        targetDurationSeconds: { type: 'number', minimum: 2, maximum: 180 },
        aspectRatio: { enum: ['16:9', '9:16', '1:1'] },
        style: { type: 'string', maxLength: 800 },
        fps: { type: 'integer', minimum: 8, maximum: 60 },
        shotCount: { type: 'integer', minimum: 1, maximum: 24 },
      },
    };
  }
  return {
    type: 'object', additionalProperties: false, required: ['projectId'],
    properties: {
      projectId: { type: 'string', pattern: '^media_[a-z0-9]{8,32}$' },
      ...(id === MEDIA_GET_OUTPUT ? { stitch: { type: 'boolean' } } : {}),
    },
  };
}

async function availability(
  port: MediaCapabilityPort,
  requireBackend: boolean,
  id: string,
): Promise<CapabilityAvailabilityState> {
  const state = await port.availability();
  if (!state.configured) {
    return { id, availability: 'not_configured', degraded: false, reason: state.reason };
  }
  if (!state.bridgeConnected) {
    return { id, availability: 'failed', degraded: true, reason: state.reason };
  }
  if (requireBackend && !state.backendReachable) {
    return { id, availability: 'unavailable', degraded: true, reason: state.reason || 'ComfyUI backend is offline.' };
  }
  return {
    id,
    availability: 'up',
    degraded: !state.backendReachable || !state.comfyConnected,
    ...(!state.backendReachable ? { reason: state.reason || 'ComfyUI backend is offline.' } : {}),
  };
}

function ok(
  id: string,
  content: string,
  structured: Record<string, unknown>,
  sideEffect: CapabilityResult['sideEffect'],
): CapabilityResult {
  return {
    capabilityId: id,
    status: 'ok',
    structured,
    content,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect,
  };
}

function mediaFailure(id: string, sideEffect: CapabilityResult['sideEffect'], error: unknown): CapabilityResult {
  const message = error instanceof Error ? error.message : String(error);
  const cancelled = /MEDIA_OPERATION_CANCELLED|aborted|cancelled/iu.test(message);
  const unavailable = /not reachable|missing|required tool|ECONNREFUSED|unavailable/iu.test(message);
  return {
    capabilityId: id,
    status: cancelled ? 'cancelled' : unavailable ? 'unavailable' : 'error',
    structured: {
      status: cancelled ? 'cancelled' : 'failed',
      reasonCode: cancelled ? 'MEDIA_CANCELLED' : unavailable ? 'MEDIA_BACKEND_UNAVAILABLE' : 'MEDIA_OPERATION_FAILED',
    },
    content: cancelled ? 'Media operation cancelled.' : message.slice(0, 800),
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect,
    error: cancelled ? 'MEDIA_CANCELLED' : unavailable ? 'MEDIA_BACKEND_UNAVAILABLE' : 'MEDIA_OPERATION_FAILED',
  };
}

function mediaStatusSummary(state: Record<string, unknown>): string {
  const status = typeof state.status === 'string' ? state.status : 'unknown';
  const shots = Array.isArray(state.shots) ? state.shots.length : 0;
  const final = typeof state.final_video === 'string' && state.final_video ? ' Final video is ready.' : '';
  return `Media project ${status}; ${shots} shot(s).${final}`;
}

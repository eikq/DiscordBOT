import type { CapabilityHandler, CapabilityHost, CapabilityResult } from '../capabilities/types';
import type { JarvisWindowHost } from './windowHost';
import {
  DESKTOP_FOCUS_JARVIS_WINDOW,
  DESKTOP_GET_JARVIS_WINDOW,
  DESKTOP_LIST_DISPLAYS,
  DESKTOP_MOVE_JARVIS_WINDOW,
  DESKTOP_SET_JARVIS_LAYOUT,
  DESKTOP_SET_JARVIS_WINDOW_BOUNDS,
  type DisplayBounds,
  type DisplaySelector,
  type JarvisLayout,
  type WindowOpResult,
} from './types';

export function registerDesktopPresenceCapabilities(
  host: CapabilityHost,
  options: { windowHost: JarvisWindowHost },
): void {
  host.register(readHandler(DESKTOP_LIST_DISPLAYS, 'List attached displays. Read-only.', async () => {
    const listed = await options.windowHost.listDisplays();
    return {
      capabilityId: DESKTOP_LIST_DISPLAYS,
      status: listed.status === 'ok' ? 'ok' : 'unavailable',
      structured: {
        status: listed.status === 'ok' ? 'completed' : 'unavailable',
        reasonCode: listed.reasonCode,
        hostKind: listed.hostKind,
        displays: listed.displays,
        primaryId: listed.primaryId,
        risk: 'READ_ONLY',
      },
      content: listed.message,
      sourceUrls: [],
      untrustedOutput: false,
      sideEffect: 'read',
      ...(listed.reasonCode ? { error: listed.reasonCode } : {}),
    };
  }));

  host.register(readHandler(DESKTOP_GET_JARVIS_WINDOW, 'Read Jarvis window bounds and current display.', async () => {
    return fromOp(DESKTOP_GET_JARVIS_WINDOW, await options.windowHost.getJarvisWindow(), 'read', 'READ_ONLY');
  }));

  host.register(writeHandler(DESKTOP_MOVE_JARVIS_WINDOW, 'Move the Jarvis window to a selected display.', {
    displaySelector: { type: 'object' },
    displayId: { type: 'string' },
    displayIndex: { type: 'number' },
    displayName: { type: 'string' },
    role: { type: 'string' },
  }, async (input) => {
    return fromOp(DESKTOP_MOVE_JARVIS_WINDOW, await options.windowHost.moveJarvisWindow(selectorFrom(input)), 'write', 'CONFIRM_REQUIRED');
  }));

  host.register(writeHandler(DESKTOP_SET_JARVIS_WINDOW_BOUNDS, 'Resize the Jarvis window only.', {
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
  }, async (input) => {
    return fromOp(
      DESKTOP_SET_JARVIS_WINDOW_BOUNDS,
      await options.windowHost.setJarvisWindowBounds(boundsFrom(input)),
      'write',
      'CONFIRM_REQUIRED',
    );
  }));

  host.register(writeHandler(DESKTOP_FOCUS_JARVIS_WINDOW, 'Focus the Jarvis window only.', {}, async () => {
    return fromOp(DESKTOP_FOCUS_JARVIS_WINDOW, await options.windowHost.focusJarvisWindow(), 'write', 'CONFIRM_REQUIRED');
  }));

  host.register(writeHandler(DESKTOP_SET_JARVIS_LAYOUT, 'Set Jarvis window layout on a display.', {
    layout: { type: 'string' },
    displaySelector: { type: 'object' },
    displayId: { type: 'string' },
    displayIndex: { type: 'number' },
    displayName: { type: 'string' },
    role: { type: 'string' },
  }, async (input) => {
    return fromOp(
      DESKTOP_SET_JARVIS_LAYOUT,
      await options.windowHost.setJarvisLayout(String(input.layout || 'normal') as JarvisLayout, selectorFrom(input) || undefined),
      'write',
      'CONFIRM_REQUIRED',
    );
  }));
}

function readHandler(
  id: string,
  description: string,
  invoke: () => Promise<CapabilityResult>,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id,
      description,
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: { type: 'object' },
      sideEffect: 'read',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 18_000,
      untrustedOutput: false,
    }),
    availability: async () => ({ id, availability: 'up', degraded: false }),
    invoke,
  };
}

function writeHandler(
  id: string,
  description: string,
  properties: Record<string, { type: string }>,
  invoke: (input: Record<string, unknown>) => Promise<CapabilityResult>,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id,
      description,
      inputSchema: { type: 'object', additionalProperties: false, properties },
      outputSchema: { type: 'object' },
      sideEffect: 'write',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 20_000,
      untrustedOutput: false,
    }),
    availability: async () => ({ id, availability: 'up', degraded: false }),
    invoke,
  };
}

function fromOp(
  capabilityId: string,
  op: WindowOpResult,
  sideEffect: 'read' | 'write',
  risk: 'READ_ONLY' | 'CONFIRM_REQUIRED',
): CapabilityResult {
  const ok = op.status !== 'unavailable' && op.status !== 'failed';
  return {
    capabilityId,
    status: ok ? 'ok' : op.status === 'unavailable' ? 'unavailable' : 'error',
    structured: {
      status: ok ? 'completed' : op.status,
      result: op.status,
      reasonCode: op.reasonCode,
      hostKind: op.hostKind,
      window: op.window,
      display: op.display,
      risk,
    },
    content: op.message,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect,
    ...(ok ? {} : { error: op.reasonCode || op.status }),
  };
}

function selectorFrom(input: Record<string, unknown>): DisplaySelector {
  const nested = input.displaySelector && typeof input.displaySelector === 'object' && !Array.isArray(input.displaySelector)
    ? input.displaySelector as Record<string, unknown>
    : input;
  const selector: DisplaySelector = {};
  if (typeof nested.index === 'number') selector.index = nested.index;
  if (typeof nested.displayIndex === 'number') selector.index = nested.displayIndex;
  if (typeof nested.id === 'string') selector.id = nested.id;
  if (typeof nested.displayId === 'string') selector.id = nested.displayId;
  if (typeof nested.name === 'string') selector.name = nested.name;
  if (typeof nested.displayName === 'string') selector.name = nested.displayName;
  if (nested.role === 'primary' || nested.role === 'current' || nested.role === 'external' || nested.role === 'notebook' || nested.role === 'main') {
    selector.role = nested.role;
  }
  return selector;
}

function boundsFrom(input: Record<string, unknown>): DisplayBounds {
  return {
    x: Number(input.x),
    y: Number(input.y),
    width: Number(input.width),
    height: Number(input.height),
  };
}

import type { CapabilityHandler, CapabilityHost, CapabilityResult } from '../types';
import { applicationById, projectById } from './allowlists';
import {
  DESKTOP_FOCUS_WINDOW,
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_OPEN_SETTINGS,
  DESKTOP_OPEN_TRUSTED_URL,
  DESKTOP_PLACE_WINDOW,
  SYSTEM_STATUS,
} from './constants';
import { readBatteryStatus, type BatterySnapshot } from './batteryStatus';
import { readNetworkStatus, type NetworkSnapshot } from './networkStatus';
import { loadSettingsAllowlist, settingsById } from './settingsAllowlist';
import type { DesktopActionAdapter, ScopedDesktopResult } from './DesktopActionAdapter';
import type { DesktopAllowlists, DesktopLaunchResult } from './types';
import { processNameForApplication, processNameForUrl } from '../../desktop/windowsDisplayHost';
import { applyOwnerDisplaySelector } from '../../intent/semanticRoute';
import { resolveDisplaySelector, sanitizeDisplaySelector, type DisplayInfo, type DisplaySelector } from '../../desktop/monitorTopology';
import type { OwnerAliasRecord } from '../../memory/ownerSemantics';

export type SystemStatusSnapshot = {
  cpu?: { usagePct: number; cores: number };
  ram?: { totalMb: number; freeMb: number; usedPct: number };
  disk?: { totalGb: number; freeGb: number; usedPct: number };
  gpu?: { name: string; utilizationPct?: number; vramUsedMb?: number; vramTotalMb?: number };
  gpuUnavailableReason?: string;
  battery?: BatterySnapshot;
  network?: NetworkSnapshot;
};

export type SystemStatusPort = {
  snapshot: () => Promise<SystemStatusSnapshot>;
};

export function registerDesktopCapabilities(
  host: CapabilityHost,
  options: {
    adapter: DesktopActionAdapter;
    allowlists: DesktopAllowlists;
    systemStatus?: SystemStatusPort;
    displayAliases?: () => OwnerAliasRecord[];
  },
): void {
  host.register(createOpenApplicationHandler(options.adapter, options.allowlists));
  host.register(createOpenProjectHandler(options.adapter, options.allowlists));
  host.register(createOpenTrustedUrlHandler(options.adapter));
  host.register(createOpenSettingsHandler(options.adapter, options.allowlists));
  host.register(createOpenScopedResourceHandler(options.adapter, options.allowlists, options.displayAliases));
  host.register(createPlaceWindowHandler(options.adapter, options.allowlists, options.displayAliases));
  host.register(createFocusWindowHandler(options.adapter, options.allowlists));
  host.register(createSystemStatusHandler(options.systemStatus));
}

async function placeAfterOpen(
  adapter: DesktopActionAdapter,
  processName: string,
  display: DisplayInfo,
  windowHandle?: string,
): Promise<ScopedDesktopResult> {
  if (!adapter.placeWindow) {
    return { status: 'unavailable', errorCode: 'DISPLAY_TOPOLOGY_UNKNOWN', placement: 'unverified' };
  }
  let last: ScopedDesktopResult = {
    status: 'unavailable',
    errorCode: 'WINDOW_NOT_FOUND',
    placement: 'failed',
    placementReason: 'WINDOW_NOT_FOUND',
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    last = await adapter.placeWindow({
      processName,
      displayId: display.id,
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height,
      ...(windowHandle ? { windowHandle } : {}),
    });
    if (last.placement === 'placed' || last.errorCode !== 'WINDOW_NOT_FOUND') return last;
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  return last;
}

function resolveRequestedDisplay(
  displays: DisplayInfo[],
  raw: unknown,
  aliases?: () => OwnerAliasRecord[],
  currentDisplayId?: string,
) {
  const applied = applyOwnerDisplaySelector(sanitizeDisplaySelector(raw) ?? (raw as DisplaySelector | null), aliases?.());
  return resolveDisplaySelector(displays, applied ?? null, currentDisplayId);
}

function createOpenApplicationHandler(
  adapter: DesktopActionAdapter,
  lists: DesktopAllowlists,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id: DESKTOP_OPEN_APPLICATION,
      description: 'Open an allowlisted local application by applicationId.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['applicationId'],
        properties: { applicationId: { type: 'string' } },
      },
      outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
      sideEffect: 'write',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 5_000,
      untrustedOutput: false,
      effects: [{
        kind: 'APPLICATION_LAUNCH',
        description: 'Start one allowlisted local application.',
        destructive: false,
        reversible: true,
        privilege: 'standard_user',
        targetInputFields: ['applicationId'],
        estimatedAffectedObjects: 1,
      }],
      verification: { mode: 'handler_result', description: 'Confirm the trusted launcher accepted the application request.' },
      rollback: { mode: 'not_required', strategy: 'Opening an application does not mutate persistent owner state.' },
    }),
    availability: async () => ({ id: DESKTOP_OPEN_APPLICATION, availability: 'up', degraded: false }),
    invoke: async (input) => {
      const applicationId = String(input.applicationId ?? '');
      const app = applicationById(lists, applicationId);
      const launched = await adapter.openApplication(applicationId);
      return launchResult(DESKTOP_OPEN_APPLICATION, launched, app?.displayName || applicationId, `application:${applicationId}`);
    },
  };
}

function createOpenProjectHandler(
  adapter: DesktopActionAdapter,
  lists: DesktopAllowlists,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id: DESKTOP_OPEN_PROJECT,
      description: 'Reveal an allowlisted project folder by projectId.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['projectId'],
        properties: { projectId: { type: 'string' } },
      },
      outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
      sideEffect: 'write',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 5_000,
      untrustedOutput: false,
      effects: [{
        kind: 'APPLICATION_LAUNCH',
        description: 'Open one allowlisted project folder in File Explorer.',
        destructive: false,
        reversible: true,
        privilege: 'standard_user',
        targetInputFields: ['projectId'],
        estimatedAffectedObjects: 1,
      }],
      verification: { mode: 'handler_result', description: 'Confirm the trusted launcher accepted the project request.' },
      rollback: { mode: 'not_required', strategy: 'Revealing a folder does not mutate project files.' },
    }),
    availability: async () => ({ id: DESKTOP_OPEN_PROJECT, availability: 'up', degraded: false }),
    invoke: async (input) => {
      const projectId = String(input.projectId ?? '');
      const project = projectById(lists, projectId);
      const launched = await adapter.openProject(projectId);
      return launchResult(DESKTOP_OPEN_PROJECT, launched, project?.displayName || projectId, `project:${projectId}`);
    },
  };
}

function createOpenSettingsHandler(
  adapter: DesktopActionAdapter,
  lists: DesktopAllowlists,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id: DESKTOP_OPEN_SETTINGS,
      description: 'Open an allowlisted Windows Settings page by settingsId.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['settingsId'],
        properties: { settingsId: { type: 'string' } },
      },
      outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
      sideEffect: 'write',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 5_000,
      untrustedOutput: false,
      effects: [{
        kind: 'APPLICATION_LAUNCH',
        description: 'Open one allowlisted Windows Settings page without changing settings.',
        destructive: false,
        reversible: true,
        privilege: 'standard_user',
        targetInputFields: ['settingsId'],
        estimatedAffectedObjects: 1,
      }],
      verification: { mode: 'handler_result', description: 'Confirm the trusted launcher accepted the settings request.' },
      rollback: { mode: 'not_required', strategy: 'Opening Settings does not itself change system configuration.' },
    }),
    availability: async () => ({ id: DESKTOP_OPEN_SETTINGS, availability: 'up', degraded: false }),
    invoke: async (input) => {
      const settingsId = String(input.settingsId ?? '');
      const page = settingsById(loadSettingsAllowlist(lists.workspaceRoot), settingsId);
      if (!adapter.openSettings) {
        return {
          capabilityId: DESKTOP_OPEN_SETTINGS,
          status: 'unavailable',
          structured: { status: 'unavailable', reasonCode: 'SETTINGS_UNAVAILABLE', risk: 'LOW_RISK_ACTION' },
          content: 'Opening Settings is unavailable.',
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
          error: 'SETTINGS_UNAVAILABLE',
        };
      }
      const launched = await adapter.openSettings(settingsId);
      return launchResult(DESKTOP_OPEN_SETTINGS, launched, page?.displayName || settingsId, `settings:${settingsId}`);
    },
  };
}

function createOpenTrustedUrlHandler(adapter: DesktopActionAdapter): CapabilityHandler {
  return {
    descriptor: () => ({
      id: DESKTOP_OPEN_TRUSTED_URL,
      description: 'Open a validated http(s) URL with the trusted local opener.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['url'],
        properties: { url: { type: 'string' } },
      },
      outputSchema: { type: 'object', properties: { status: { type: 'string' } } },
      sideEffect: 'write',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 5_000,
      untrustedOutput: false,
      effects: [{
        kind: 'APPLICATION_LAUNCH',
        description: 'Open one validated URL through the trusted local opener.',
        destructive: false,
        reversible: true,
        privilege: 'owner_approval',
        targetInputFields: ['url'],
        estimatedAffectedObjects: 1,
      }],
      verification: { mode: 'handler_result', description: 'Confirm the trusted opener accepted the URL request.' },
      rollback: { mode: 'not_required', strategy: 'Opening a URL does not itself change persistent owner state.' },
    }),
    availability: async () => ({ id: DESKTOP_OPEN_TRUSTED_URL, availability: 'up', degraded: false }),
    invoke: async (input) => {
      const url = String(input.url ?? '');
      const launched = await adapter.openUrl(url);
      return launchResult(DESKTOP_OPEN_TRUSTED_URL, launched, url, 'url');
    },
  };
}

function createOpenScopedResourceHandler(
  adapter: DesktopActionAdapter,
  lists: DesktopAllowlists,
  displayAliases?: () => OwnerAliasRecord[],
): CapabilityHandler {
  return {
    descriptor: () => ({
      id: DESKTOP_OPEN_SCOPED_RESOURCE,
      description: 'Open one allowlisted application or web destination, optionally targeting a verified display.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          applicationId: { type: 'string' },
          url: { type: 'string' },
          projectId: { type: 'string' },
          label: { type: 'string' },
          display: { type: 'object' },
        },
      },
      outputSchema: { type: 'object' },
      sideEffect: 'write',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 35_000,
      untrustedOutput: false,
      effects: [{
        kind: 'APPLICATION_LAUNCH',
        description: 'Open one allowlisted resource and optionally place its window.',
        destructive: false,
        reversible: true,
        privilege: 'standard_user',
        targetInputFields: ['applicationId', 'url'],
        estimatedAffectedObjects: 1,
      }],
      verification: { mode: 'handler_result', description: 'Confirm the trusted opener accepted the request and report placement honestly.' },
      rollback: { mode: 'not_required', strategy: 'Opening a resource does not mutate persistent owner state.' },
    }),
    availability: async () => ({ id: DESKTOP_OPEN_SCOPED_RESOURCE, availability: 'up', degraded: false }),
    invoke: async (input) => {
      const kind = input.kind === 'url' || input.url ? 'url' : 'application';
      const label = String(input.label || input.applicationId || input.url || 'resource');
      const launched = kind === 'url'
        ? await adapter.openUrl(String(input.url ?? ''))
        : typeof input.projectId === 'string' && adapter.openApplicationWithProject
          ? await adapter.openApplicationWithProject(String(input.applicationId ?? ''), String(input.projectId))
          : await adapter.openApplication(String(input.applicationId ?? ''));
      const base = launchResult(DESKTOP_OPEN_SCOPED_RESOURCE, launched, label, kind);
      if (launched.status !== 'started' || !input.display) return base;
      const displays = adapter.listDisplays ? await adapter.listDisplays() : [];
      if (!displays.length || !adapter.placeWindow) {
        return {
          ...base,
          structured: { ...asRecord(base.structured), placement: 'unverified', reasonCode: 'DISPLAY_TOPOLOGY_UNKNOWN' },
          content: `${base.content} Monitor placement could not be verified.`,
        };
      }
      const resolved = resolveRequestedDisplay(displays, input.display, displayAliases);
      if (resolved.ok === false) {
        return {
          ...base,
          structured: { ...asRecord(base.structured), placement: 'unverified', reasonCode: resolved.reasonCode },
          content: `${base.content} ${resolved.message}`,
        };
      }
      const processName = kind === 'url'
        ? processNameForUrl(String(input.url ?? ''))
        : processNameForApplication(String(input.applicationId ?? ''));
      if (!processName) {
        return {
          ...base,
          structured: { ...asRecord(base.structured), placement: 'unverified', reasonCode: 'PROCESS_NOT_ALLOWLISTED' },
          content: `${base.content} I cannot place that window yet.`,
        };
      }
      const placed = await placeAfterOpen(adapter, processName, resolved.display);
      const reason = placed.placementReason || placed.errorCode;
      const thai = /[\u0E00-\u0E7F]/.test(base.content);
      return {
        ...base,
        structured: {
          ...asRecord(base.structured),
          placement: placed.placement || 'unverified',
          displayId: resolved.display.id,
          ...(placed.windowHandle ? { windowHandle: placed.windowHandle } : {}),
          ...(reason ? { reasonCode: reason } : {}),
        },
        content: placed.placement === 'placed'
          ? (thai ? `เปิด ${label} บนจอที่ขอแล้วครับ` : `${label} is open on the requested display.`)
          : thai
            ? `${base.content} ยังย้ายหน้าต่างไปจอที่ขอไม่ได้${reason ? ` (${reason})` : ''}`
            : `${base.content} Placement is ${placed.placement || 'unverified'}${reason ? ` (${reason})` : ''}.`,
      };
    },
  };
}

function createPlaceWindowHandler(
  adapter: DesktopActionAdapter,
  lists: DesktopAllowlists,
  displayAliases?: () => OwnerAliasRecord[],
): CapabilityHandler {
  return {
    descriptor: () => ({
      id: DESKTOP_PLACE_WINDOW,
      description: 'Move an already-open allowlisted application or trusted-browser website window onto a verified display. Does not navigate or click.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          applicationId: { type: 'string' },
          url: { type: 'string' },
          label: { type: 'string' },
          display: { type: 'object' },
          windowHandle: { type: 'string' },
        },
      },
      outputSchema: { type: 'object' },
      sideEffect: 'write',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 25_000,
      untrustedOutput: false,
      effects: [{
        kind: 'MOVE',
        description: 'Move one already-open allowlisted application or trusted-browser window onto a verified display.',
        destructive: false,
        reversible: true,
        privilege: 'standard_user',
        targetInputFields: ['applicationId', 'url'],
        estimatedAffectedObjects: 1,
      }],
      verification: { mode: 'handler_result', description: 'Report whether the existing window was found and placed.' },
      rollback: { mode: 'not_required', strategy: 'The owner can ask to move the same window back.' },
    }),
    availability: async () => ({ id: DESKTOP_PLACE_WINDOW, availability: adapter.placeWindow ? 'up' : 'unavailable', degraded: !adapter.placeWindow }),
    invoke: async (input) => {
      const applicationId = typeof input.applicationId === 'string' ? input.applicationId : '';
      const url = typeof input.url === 'string' ? input.url : '';
      const app = applicationId ? applicationById(lists, applicationId) : undefined;
      const label = String(input.label || app?.displayName || applicationId || url || 'that window');
      const processName = applicationId
        ? processNameForApplication(applicationId)
        : processNameForUrl(url);
      if (applicationId && !app) {
        return {
          capabilityId: DESKTOP_PLACE_WINDOW,
          status: 'error',
          structured: { status: 'failed', reasonCode: 'UNKNOWN_APPLICATION', risk: 'BLOCKED' },
          content: 'That application is not on the open allowlist.',
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
          error: 'UNKNOWN_APPLICATION',
        };
      }
      if (!processName) {
        return {
          capabilityId: DESKTOP_PLACE_WINDOW,
          status: 'unavailable',
          structured: { status: 'unavailable', reasonCode: 'PROCESS_NOT_ALLOWLISTED', risk: 'LOW_RISK_ACTION' },
          content: `I understand you mean ${label}, but I cannot identify a trusted window process to move.`,
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
          error: 'PROCESS_NOT_ALLOWLISTED',
        };
      }
      if (!adapter.placeWindow || !adapter.listDisplays) {
        return {
          capabilityId: DESKTOP_PLACE_WINDOW,
          status: 'unavailable',
          structured: { status: 'unavailable', reasonCode: 'DISPLAY_TOPOLOGY_UNKNOWN', risk: 'LOW_RISK_ACTION' },
          content: 'I cannot verify monitor placement on this host.',
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
          error: 'DISPLAY_TOPOLOGY_UNKNOWN',
        };
      }
      const displays = await adapter.listDisplays();
      const resolved = resolveRequestedDisplay(displays, input.display, displayAliases);
      if (resolved.ok === false) {
        return {
          capabilityId: DESKTOP_PLACE_WINDOW,
          status: 'unavailable',
          structured: { status: 'unavailable', reasonCode: resolved.reasonCode, risk: 'LOW_RISK_ACTION' },
          content: resolved.message,
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
          error: resolved.reasonCode,
        };
      }
      const placed = await adapter.placeWindow({
        processName,
        displayId: resolved.display.id,
        x: resolved.display.x,
        y: resolved.display.y,
        width: resolved.display.width,
        height: resolved.display.height,
        ...(typeof input.windowHandle === 'string' ? { windowHandle: input.windowHandle } : {}),
      });
      if (placed.status === 'started') {
        return {
          capabilityId: DESKTOP_PLACE_WINDOW,
          status: 'ok',
          structured: {
            status: 'completed',
            risk: 'LOW_RISK_ACTION',
            placement: placed.placement,
            displayId: resolved.display.id,
            ...(placed.windowHandle ? { windowHandle: placed.windowHandle } : {}),
          },
          content: placed.placement === 'placed'
            ? url
              ? `Moved the trusted browser window for ${label}. If that browser has several tabs, I cannot move only that tab.`
              : `Moved ${label} to the requested display.`
            : `I found ${label}, but placement is ${placed.placement || 'unverified'}.`,
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
        };
      }
      if (placed.errorCode === 'WINDOW_NOT_FOUND') {
        return {
          capabilityId: DESKTOP_PLACE_WINDOW,
          status: 'unavailable',
          structured: { status: 'unavailable', reasonCode: 'WINDOW_NOT_FOUND', risk: 'LOW_RISK_ACTION' },
          content: `I understand you mean ${label}. I do not see that window open yet, so I cannot move it.`,
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
          error: 'WINDOW_NOT_FOUND',
        };
      }
      return {
        capabilityId: DESKTOP_PLACE_WINDOW,
        status: placed.status === 'unavailable' ? 'unavailable' : 'error',
        structured: { status: 'failed', reasonCode: placed.errorCode, risk: 'LOW_RISK_ACTION' },
        content: placed.message || `I could not move ${label}.`,
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'write',
        error: placed.errorCode,
      };
    },
  };
}

function createFocusWindowHandler(
  adapter: DesktopActionAdapter,
  lists: DesktopAllowlists,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id: DESKTOP_FOCUS_WINDOW,
      description: 'Focus an allowlisted application window.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['applicationId'],
        properties: { applicationId: { type: 'string' } },
      },
      outputSchema: { type: 'object' },
      sideEffect: 'write',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 5_000,
      untrustedOutput: false,
    }),
    availability: async () => ({ id: DESKTOP_FOCUS_WINDOW, availability: adapter.focusWindow ? 'up' : 'unavailable', degraded: !adapter.focusWindow }),
    invoke: async (input) => {
      const applicationId = String(input.applicationId ?? '');
      const app = applicationById(lists, applicationId);
      if (!app || !adapter.focusWindow) {
        return {
          capabilityId: DESKTOP_FOCUS_WINDOW,
          status: 'unavailable',
          structured: { status: 'unavailable', reasonCode: app ? 'FOCUS_UNAVAILABLE' : 'UNKNOWN_APPLICATION', risk: 'LOW_RISK_ACTION' },
          content: app ? 'Focus is unavailable on this host.' : 'That application is not on the open allowlist.',
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
          error: app ? 'FOCUS_UNAVAILABLE' : 'UNKNOWN_APPLICATION',
        };
      }
      const focused = await adapter.focusWindow({ processName: applicationId });
      return launchResult(DESKTOP_FOCUS_WINDOW, focused, app.displayName, `focus:${applicationId}`);
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function createSystemStatusHandler(port?: SystemStatusPort): CapabilityHandler {
  return {
    descriptor: () => ({
      id: SYSTEM_STATUS,
      description: 'Return honest local system telemetry. Missing sensors are marked unavailable.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: { type: 'object' },
      sideEffect: 'read',
      requiredService: 'system',
      providerKind: 'local',
      timeoutMs: 4_000,
      untrustedOutput: false,
    }),
    availability: async () => ({
      id: SYSTEM_STATUS,
      availability: port ? 'up' : 'unavailable',
      degraded: !port,
    }),
    invoke: async () => {
      if (!port) {
        return {
          capabilityId: SYSTEM_STATUS,
          status: 'unavailable',
          structured: { status: 'unavailable', reasonCode: 'TELEMETRY_UNAVAILABLE', risk: 'READ_ONLY' },
          content: 'System telemetry is unavailable.',
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'read',
          error: 'TELEMETRY_UNAVAILABLE',
        };
      }
      const snapshot = await port.snapshot();
      if (!snapshot.battery) snapshot.battery = await readBatteryStatus();
      if (!snapshot.network) snapshot.network = readNetworkStatus();
      return {
        capabilityId: SYSTEM_STATUS,
        status: 'ok',
        structured: { status: 'completed', snapshot, risk: 'READ_ONLY' },
        content: summarizeStatus(snapshot),
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'read',
      };
    },
  };
}

function launchResult(
  capabilityId: string,
  launched: DesktopLaunchResult,
  label: string,
  _targetClass: string,
): CapabilityResult {
  if (launched.status === 'started') {
    return {
      capabilityId,
      status: 'ok',
      structured: { status: 'completed', risk: 'LOW_RISK_ACTION' },
      content: `เปิด ${label} ให้แล้วครับ`,
      sourceUrls: [],
      untrustedOutput: false,
      sideEffect: 'write',
    };
  }
  if (launched.status === 'unavailable') {
    return {
      capabilityId,
      status: 'unavailable',
      structured: { status: 'unavailable', reasonCode: launched.errorCode, risk: 'LOW_RISK_ACTION' },
      content: `${label} ยังไม่พร้อมใช้งานครับ`,
      sourceUrls: [],
      untrustedOutput: false,
      sideEffect: 'write',
      error: launched.errorCode,
    };
  }
  return {
    capabilityId,
    status: 'error',
    structured: { status: 'failed', reasonCode: launched.errorCode, risk: 'LOW_RISK_ACTION' },
    content: `เปิด ${label} ไม่สำเร็จครับ`,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'write',
    error: launched.errorCode || launched.message,
  };
}

function summarizeStatus(snapshot: SystemStatusSnapshot): string {
  const parts: string[] = [];
  parts.push(snapshot.cpu
    ? `CPU ${snapshot.cpu.usagePct}% (${snapshot.cpu.cores} cores)`
    : 'CPU unavailable');
  parts.push(snapshot.ram
    ? `RAM ${snapshot.ram.usedPct}% used, ${snapshot.ram.freeMb} MB free`
    : 'RAM unavailable');
  parts.push(snapshot.disk
    ? `Disk ${snapshot.disk.freeGb} GB free`
    : 'Disk unavailable');
  parts.push(snapshot.gpu
    ? `GPU ${snapshot.gpu.name}${snapshot.gpu.utilizationPct !== undefined ? ` ${snapshot.gpu.utilizationPct}%` : ''}`
    : (snapshot.gpuUnavailableReason || 'GPU unavailable'));
  parts.push(snapshot.battery?.status === 'ok' && snapshot.battery.percent !== undefined
    ? `Battery ${snapshot.battery.percent}%${snapshot.battery.charging ? ' charging' : ''}`
    : 'Battery unavailable');
  parts.push(snapshot.network?.status === 'ok'
    ? (snapshot.network.available ? `Network ${snapshot.network.interfaceClass || 'up'}` : 'Network offline')
    : 'Network unavailable');
  return parts.join(' · ');
}

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
import { processNameForApplication, processNameForUrl, processNamesForUrl, WindowsDesktopPerception } from '../../desktop/windowsDisplayHost';
import { applyOwnerDisplaySelector } from '../../intent/semanticRoute';
import { resolveDisplaySelector, sanitizeDisplaySelector, type DisplayInfo, type DisplaySelector } from '../../desktop/monitorTopology';
import type { OwnerAliasRecord } from '../../memory/ownerSemantics';
import { createManagedWindow, sharedManagedWindows, type ManagedWindowStore } from '../../desktop/managedWindows';
import { observeAfterOpen } from '../../desktop/openVerify';
import { verifyPlacement, type DesktopPerceptionProvider } from '../../desktop/perception';

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
    perception?: DesktopPerceptionProvider;
    managedWindows?: ManagedWindowStore;
  },
): void {
  const perception = options.perception ?? (options.adapter.perceiveDesktop
    ? { snapshot: () => options.adapter.perceiveDesktop!(), getWindow: async (handle) => (await options.adapter.perceiveDesktop!()).windows.find(item => item.windowHandle === handle) ?? null }
    : new WindowsDesktopPerception());
  const managedWindows = options.managedWindows ?? sharedManagedWindows();
  host.register(createOpenApplicationHandler(options.adapter, options.allowlists));
  host.register(createOpenProjectHandler(options.adapter, options.allowlists));
  host.register(createOpenTrustedUrlHandler(options.adapter));
  host.register(createOpenSettingsHandler(options.adapter, options.allowlists));
  host.register(createOpenScopedResourceHandler(options.adapter, options.allowlists, options.displayAliases, perception, managedWindows));
  host.register(createPlaceWindowHandler(options.adapter, options.allowlists, options.displayAliases, perception, managedWindows));
  host.register(createFocusWindowHandler(options.adapter, options.allowlists, managedWindows));
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
  _lists: DesktopAllowlists,
  displayAliases?: () => OwnerAliasRecord[],
  perception?: DesktopPerceptionProvider,
  managedWindows?: ManagedWindowStore,
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
        targetInputFields: ['applicationId', 'url', 'windowHandle'],
        estimatedAffectedObjects: 1,
      }],
      verification: { mode: 'structured_postcondition', description: 'Identify the resulting managed window and verify placement from observed bounds.' },
      rollback: { mode: 'not_required', strategy: 'Opening a resource does not mutate persistent owner state.' },
      intelligence: {
        maturity: 'REAL',
        executionMode: 'REAL',
        knownLimitations: [
          'A handler start is not window verification.',
          'Browser title is not treated as an independently verified URL.',
          'Ambiguous new windows are reported, not guessed.',
        ],
      },
    }),
    availability: async () => ({ id: DESKTOP_OPEN_SCOPED_RESOURCE, availability: 'up', degraded: false }),
    invoke: async (input) => {
      const kind = input.kind === 'url' || input.url ? 'url' : 'application';
      const label = String(input.label || input.applicationId || input.url || 'resource');
      const url = kind === 'url' ? String(input.url ?? '') : undefined;
      const applicationId = kind === 'application' ? String(input.applicationId ?? '') : undefined;
      const processNames = url
        ? processNamesForUrl(url)
        : [processNameForApplication(String(applicationId || ''))].filter((item): item is string => Boolean(item));
      const pre = perception ? await perception.snapshot() : undefined;
      const launched = kind === 'url'
        ? await adapter.openUrl(String(url ?? ''))
        : typeof input.projectId === 'string' && adapter.openApplicationWithProject
          ? await adapter.openApplicationWithProject(String(applicationId ?? ''), String(input.projectId))
          : await adapter.openApplication(String(applicationId ?? ''));
      const base = launchResult(DESKTOP_OPEN_SCOPED_RESOURCE, launched, label, kind);
      const discovered = launched.status === 'started' && perception && processNames.length
        ? await observeAfterOpen({
          perception,
          pre: pre || await perception.snapshot(),
          expectedProcessNames: processNames,
          url,
          label,
          applicationId,
        })
        : undefined;
      if (discovered && discovered.ok === false && discovered.reasonCode === 'WINDOW_IDENTITY_AMBIGUOUS') {
        return {
          ...base,
          structured: {
            ...asRecord(base.structured),
            placement: 'unverified',
            reasonCode: 'WINDOW_IDENTITY_AMBIGUOUS',
            windowVerified: false,
            dedicatedWindow: false,
          },
          content: `${base.content} ${discovered.message}`,
        };
      }
      const windowHandle = discovered && discovered.ok ? discovered.window.windowHandle : undefined;
      const dedicatedWindow = Boolean(launched.dedicatedWindow && discovered && discovered.ok && discovered.dedicated);
      let managed = discovered && discovered.ok && managedWindows
        ? managedWindows.upsert(createManagedWindow({
          openOperationId: `open_${Date.now()}`,
          resourceId: label,
          resourceType: url ? 'website' : applicationId === 'cursor' && input.projectId ? 'project' : 'application',
          windowHandle: discovered.window.windowHandle,
          processId: discovered.window.processId,
          processName: discovered.window.processName,
          observedTitle: discovered.window.title,
          expectedUrl: url,
          applicationId,
          dedicatedWindow,
          currentDisplay: discovered.window.displayFingerprint,
        }))
        : undefined;
      if (launched.status !== 'started' || !input.display) {
        return {
          ...base,
          structured: {
            ...asRecord(base.structured),
            ...(windowHandle ? { windowHandle } : {}),
            ...(managed ? { managedWindowId: managed.managedWindowId } : {}),
            windowVerified: Boolean(windowHandle),
            resourceUrlVerified: false,
            dedicatedWindow,
          },
        };
      }
      const displays = adapter.listDisplays ? await adapter.listDisplays() : [];
      if (!displays.length || !adapter.placeWindow) {
        return {
          ...base,
          structured: { ...asRecord(base.structured), placement: 'unverified', reasonCode: 'DISPLAY_TOPOLOGY_UNKNOWN', windowVerified: Boolean(windowHandle) },
          content: `${base.content} Monitor placement could not be verified.`,
        };
      }
      const resolved = resolveRequestedDisplay(displays, input.display, displayAliases);
      if (resolved.ok === false) {
        return {
          ...base,
          structured: { ...asRecord(base.structured), placement: 'unverified', reasonCode: resolved.reasonCode, windowVerified: Boolean(windowHandle) },
          content: `${base.content} ${resolved.message}`,
        };
      }
      const processName = launched.processName || processNames[0];
      if (!processName) {
        return {
          ...base,
          structured: { ...asRecord(base.structured), placement: 'unverified', reasonCode: 'PROCESS_NOT_ALLOWLISTED' },
          content: `${base.content} I cannot place that window yet.`,
        };
      }
      const placed = await placeAfterOpen(adapter, processName, resolved.display, windowHandle);
      const observed = perception && placed.windowHandle
        ? await perception.getWindow(placed.windowHandle)
        : discovered && discovered.ok ? discovered.window : undefined;
      const verified = verifyPlacement(observed, resolved.display);
      if (managed && managedWindows && verified.verified) {
        managed = managedWindows.upsert({
          ...managed,
          currentDisplay: verified.displayFingerprint || managed.currentDisplay,
          lastVerifiedAt: Date.now(),
          lastObservedAt: Date.now(),
        });
      }
      const reason = verified.verified ? undefined : (placed.placementReason || placed.errorCode || 'PLACEMENT_UNVERIFIED');
      const thai = /[\u0E00-\u0E7F]/.test(base.content);
      return {
        ...base,
        structured: {
          ...asRecord(base.structured),
          placement: verified.verified ? 'placed' : (placed.placement || 'unverified'),
          displayId: resolved.display.id,
          ...(verified.displayFingerprint ? { displayFingerprint: verified.displayFingerprint } : {}),
          ...(placed.windowHandle || windowHandle ? { windowHandle: placed.windowHandle || windowHandle } : {}),
          ...(managed ? { managedWindowId: managed.managedWindowId } : {}),
          windowVerified: Boolean(placed.windowHandle || windowHandle),
          displayVerified: verified.verified,
          resourceUrlVerified: false,
          dedicatedWindow,
          affectedTargets: [url || `application:${applicationId}`, ...(placed.windowHandle || windowHandle ? [`window:${placed.windowHandle || windowHandle}`] : [])].filter(Boolean),
          ...(reason ? { reasonCode: reason } : {}),
        },
        content: verified.verified
          ? (thai ? `เปิด ${label} บนจอที่ขอแล้วครับ` : `${label} is open on the requested display.`)
          : thai
            ? `${base.content} ยังยืนยันตำแหน่งหน้าต่างไม่ได้${reason ? ` (${reason})` : ''}`
            : `${base.content} Placement is unverified${reason ? ` (${reason})` : ''}.`,
      };
    },
  };
}

function createPlaceWindowHandler(
  adapter: DesktopActionAdapter,
  lists: DesktopAllowlists,
  displayAliases?: () => OwnerAliasRecord[],
  perception?: DesktopPerceptionProvider,
  managedWindows?: ManagedWindowStore,
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
        targetInputFields: ['applicationId', 'url', 'windowHandle'],
        estimatedAffectedObjects: 1,
      }],
      verification: { mode: 'structured_postcondition', description: 'Verify placement from observed window bounds against the target display.' },
      rollback: { mode: 'not_required', strategy: 'The owner can ask to move the same window back.' },
      intelligence: {
        maturity: 'REAL',
        executionMode: 'REAL',
        knownLimitations: [
          'PLACE is REAL only after observed overlap or center-inside verification.',
          'Failed or unverified placement does not update previousDisplay.',
        ],
      },
    }),
    availability: async () => ({ id: DESKTOP_PLACE_WINDOW, availability: adapter.placeWindow ? 'up' : 'unavailable', degraded: !adapter.placeWindow }),
    invoke: async (input) => {
      const applicationId = typeof input.applicationId === 'string' ? input.applicationId : '';
      const url = typeof input.url === 'string' ? input.url : '';
      const app = applicationId ? applicationById(lists, applicationId) : undefined;
      const label = String(input.label || app?.displayName || applicationId || url || 'that window');
      const managed = managedWindows?.resolveOne({
        url: url || undefined,
        applicationId: applicationId || undefined,
        label,
        windowHandle: typeof input.windowHandle === 'string' ? input.windowHandle : undefined,
      });
      const windowHandle = typeof input.windowHandle === 'string' ? input.windowHandle : managed?.windowHandle;
      const processName = managed?.processName
        || (applicationId ? processNameForApplication(applicationId) : processNameForUrl(url));
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
      if ((processName === 'chrome' || processName === 'msedge') && !windowHandle) {
        return {
          capabilityId: DESKTOP_PLACE_WINDOW,
          status: 'unavailable',
          structured: { status: 'unavailable', reasonCode: 'PLACE_REQUIRES_MANAGED_WINDOW', risk: 'LOW_RISK_ACTION' },
          content: `I understand you mean ${label}, but I will not guess among browser windows. I need the Jarvis-managed window first.`,
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
          error: 'PLACE_REQUIRES_MANAGED_WINDOW',
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
        ...(windowHandle ? { windowHandle } : {}),
      });
      const observedHandle = placed.windowHandle || windowHandle;
      const observed = perception && observedHandle ? await perception.getWindow(observedHandle) : undefined;
      const verified = verifyPlacement(observed, resolved.display);
      if (managed && managedWindows && verified.verified) {
        const nextCurrent = verified.displayFingerprint || managed.currentDisplay;
        managedWindows.upsert({
          ...managed,
          previousDisplay: managed.currentDisplay && managed.currentDisplay !== nextCurrent
            ? managed.currentDisplay
            : managed.previousDisplay,
          currentDisplay: nextCurrent,
          lastVerifiedAt: Date.now(),
          lastObservedAt: Date.now(),
          windowHandle: observedHandle || managed.windowHandle,
        });
      }
      if (placed.status === 'started') {
        return {
          capabilityId: DESKTOP_PLACE_WINDOW,
          status: 'ok',
          structured: {
            status: 'completed',
            risk: 'LOW_RISK_ACTION',
            placement: verified.verified ? 'placed' : (placed.placement || 'unverified'),
            displayId: resolved.display.id,
            ...(verified.displayFingerprint ? { displayFingerprint: verified.displayFingerprint } : {}),
            displayVerified: verified.verified,
            windowVerified: Boolean(observedHandle),
            resourceUrlVerified: false,
            ...(observedHandle ? { windowHandle: observedHandle } : {}),
            ...(managed ? { managedWindowId: managed.managedWindowId } : {}),
            affectedTargets: [url || `application:${applicationId}`, ...(observedHandle ? [`window:${observedHandle}`] : [])].filter(Boolean),
            ...(verified.verified ? {} : { reasonCode: placed.placementReason || 'PLACEMENT_UNVERIFIED' }),
          },
          content: verified.verified
            ? `Moved ${label} to the requested display.`
            : `I found ${label}, but placement is unverified.`,
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
  managedWindows?: ManagedWindowStore,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id: DESKTOP_FOCUS_WINDOW,
      description: 'Focus one Jarvis-managed window after identity is known.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          applicationId: { type: 'string' },
          url: { type: 'string' },
          label: { type: 'string' },
          windowHandle: { type: 'string' },
          managedWindowId: { type: 'string' },
        },
      },
      outputSchema: { type: 'object' },
      sideEffect: 'write',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 8_000,
      untrustedOutput: false,
      effects: [{
        kind: 'APPLICATION_LAUNCH',
        description: 'Focus one Jarvis-managed window.',
        destructive: false,
        reversible: true,
        privilege: 'standard_user',
        targetInputFields: ['windowHandle', 'url', 'applicationId'],
        estimatedAffectedObjects: 1,
      }],
      verification: { mode: 'structured_postcondition', description: 'Read back the foreground window handle.' },
      intelligence: {
        maturity: 'REAL',
        executionMode: 'REAL',
        knownLimitations: [
          'FOCUS operates only on a Jarvis-managed window handle.',
          'Foreground read-back is required before claiming success.',
        ],
      },
    }),
    availability: async () => ({ id: DESKTOP_FOCUS_WINDOW, availability: adapter.focusWindow ? 'up' : 'unavailable', degraded: !adapter.focusWindow }),
    invoke: async (input) => {
      const applicationId = typeof input.applicationId === 'string' ? input.applicationId : '';
      const url = typeof input.url === 'string' ? input.url : '';
      const label = String(input.label || applicationById(lists, applicationId)?.displayName || applicationId || url || 'that window');
      const managed = managedWindows?.resolveOne({
        applicationId: applicationId || undefined,
        url: url || undefined,
        label,
        windowHandle: typeof input.windowHandle === 'string' ? input.windowHandle : undefined,
        managedWindowId: typeof input.managedWindowId === 'string' ? input.managedWindowId : undefined,
      });
      const windowHandle = typeof input.windowHandle === 'string' ? input.windowHandle : managed?.windowHandle;
      if (!windowHandle || !adapter.focusWindow) {
        return {
          capabilityId: DESKTOP_FOCUS_WINDOW,
          status: 'unavailable',
          structured: { status: 'unavailable', reasonCode: 'FOCUS_REQUIRES_MANAGED_WINDOW', risk: 'LOW_RISK_ACTION' },
          content: `I can focus ${label} only after I have a Jarvis-managed window for it.`,
          sourceUrls: [],
          untrustedOutput: false,
          sideEffect: 'write',
          error: 'FOCUS_REQUIRES_MANAGED_WINDOW',
        };
      }
      const focused = await adapter.focusWindow({ windowHandle, processName: managed?.processName });
      const verified = focused.focusVerified === true;
      return {
        capabilityId: DESKTOP_FOCUS_WINDOW,
        status: focused.status === 'started' ? 'ok' : 'unavailable',
        structured: {
          status: focused.status === 'started' ? 'completed' : 'unavailable',
          reasonCode: verified ? undefined : (focused.errorCode || 'FOCUS_UNVERIFIED'),
          risk: 'LOW_RISK_ACTION',
          windowHandle,
          managedWindowId: managed?.managedWindowId,
          windowVerified: true,
          focusVerified: verified,
          affectedTargets: [`window:${windowHandle}`],
        },
        content: verified
          ? `Brought ${label} to the front.`
          : `I tried to focus ${label}, but could not verify the foreground window.`,
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'write',
        ...(verified ? {} : { error: focused.errorCode || 'FOCUS_UNVERIFIED' }),
      };
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

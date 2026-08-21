import type { CapabilityHandler, CapabilityHost, CapabilityResult } from '../types';
import { applicationById, projectById } from './allowlists';
import {
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SETTINGS,
  DESKTOP_OPEN_TRUSTED_URL,
  SYSTEM_STATUS,
} from './constants';
import { readBatteryStatus, type BatterySnapshot } from './batteryStatus';
import { readNetworkStatus, type NetworkSnapshot } from './networkStatus';
import { loadSettingsAllowlist, settingsById } from './settingsAllowlist';
import type { DesktopActionAdapter } from './DesktopActionAdapter';
import type { DesktopAllowlists, DesktopLaunchResult } from './types';

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
  },
): void {
  host.register(createOpenApplicationHandler(options.adapter, options.allowlists));
  host.register(createOpenProjectHandler(options.adapter, options.allowlists));
  host.register(createOpenTrustedUrlHandler(options.adapter));
  host.register(createOpenSettingsHandler(options.adapter, options.allowlists));
  host.register(createSystemStatusHandler(options.systemStatus));
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

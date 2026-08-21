import fs from 'node:fs';
import path from 'node:path';
import { nightAgentSnapshot } from '../../standalone/labSystem';
import type { CapabilityHandler, CapabilityHost, CapabilityResult } from '../types';
import { applicationById } from './allowlists';
import { readBatteryStatus } from './batteryStatus';
import {
  APPLICATIONS_STATUS,
  JARVIS_HEALTH_CHECK,
  JARVIS_RESTART_SERVICE,
  JARVIS_RUNTIME_STATUS,
  JARVIS_START_SERVICE,
  JARVIS_STOP_SERVICE,
  SYSTEM_BATTERY_STATUS,
  SYSTEM_NETWORK_STATUS,
} from './constants';
import { readNetworkStatus } from './networkStatus';
import { JARVIS_SERVICE_CATALOG, isJarvisServiceId, serviceRecord } from './services/catalog';
import type { JarvisServiceController } from './services/controller';
import type { DesktopAllowlists } from './types';

export type RuntimeStatusPort = {
  memoryAvailable?: () => boolean;
  skillsAvailable?: () => boolean;
};

export function registerRuntimeCapabilities(
  host: CapabilityHost,
  options: {
    allowlists: DesktopAllowlists;
    services: JarvisServiceController;
    runtime?: RuntimeStatusPort;
  },
): void {
  host.register(createBatteryHandler());
  host.register(createNetworkHandler());
  host.register(createApplicationsStatusHandler(options.allowlists));
  host.register(createRuntimeStatusHandler(options.services, options.runtime));
  host.register(createHealthCheckHandler(options.services));
  host.register(createStartHandler(options.services));
  host.register(createStopHandler(options.services));
  host.register(createRestartHandler(options.services));
}

function createBatteryHandler(): CapabilityHandler {
  return {
    descriptor: () => ({
      id: SYSTEM_BATTERY_STATUS,
      description: 'Read laptop battery percentage and charging state when available.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: { type: 'object' },
      sideEffect: 'read',
      requiredService: 'system',
      providerKind: 'local',
      timeoutMs: 3_000,
      untrustedOutput: false,
    }),
    availability: async () => ({ id: SYSTEM_BATTERY_STATUS, availability: 'up', degraded: false }),
    invoke: async () => {
      const battery = await readBatteryStatus();
      return {
        capabilityId: SYSTEM_BATTERY_STATUS,
        status: battery.status === 'ok' ? 'ok' : 'unavailable',
        structured: { status: battery.status === 'ok' ? 'completed' : 'unavailable', battery, risk: 'READ_ONLY' },
        content: battery.status === 'ok' && battery.percent !== undefined
          ? `Battery ${battery.percent}%${battery.charging ? ' charging' : battery.pluggedIn ? ' plugged in' : ''}`
          : battery.reason || 'Battery status is unavailable.',
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'read',
        ...(battery.status === 'ok' ? {} : { error: 'TELEMETRY_UNAVAILABLE' }),
      };
    },
  };
}

function createNetworkHandler(): CapabilityHandler {
  return {
    descriptor: () => ({
      id: SYSTEM_NETWORK_STATUS,
      description: 'Read local network availability without scanning or credentials.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: { type: 'object' },
      sideEffect: 'read',
      requiredService: 'system',
      providerKind: 'local',
      timeoutMs: 2_000,
      untrustedOutput: false,
    }),
    availability: async () => ({ id: SYSTEM_NETWORK_STATUS, availability: 'up', degraded: false }),
    invoke: async () => {
      const network = readNetworkStatus();
      return {
        capabilityId: SYSTEM_NETWORK_STATUS,
        status: network.status === 'ok' ? 'ok' : 'unavailable',
        structured: { status: network.status === 'ok' ? 'completed' : 'unavailable', network, risk: 'READ_ONLY' },
        content: network.status === 'ok'
          ? (network.available ? `Network available${network.interfaceClass ? ` (${network.interfaceClass})` : ''}` : 'No local network interface is up.')
          : network.reason || 'Network status is unavailable.',
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'read',
        ...(network.status === 'ok' ? {} : { error: 'TELEMETRY_UNAVAILABLE' }),
      };
    },
  };
}

function createApplicationsStatusHandler(lists: DesktopAllowlists): CapabilityHandler {
  return {
    descriptor: () => ({
      id: APPLICATIONS_STATUS,
      description: 'Report installed status of owner-allowlisted application ids only.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { applicationId: { type: 'string' } },
      },
      outputSchema: { type: 'object' },
      sideEffect: 'read',
      requiredService: 'desktop',
      providerKind: 'local',
      timeoutMs: 2_000,
      untrustedOutput: false,
    }),
    availability: async () => ({ id: APPLICATIONS_STATUS, availability: 'up', degraded: false }),
    invoke: async (input) => {
      const requested = typeof input.applicationId === 'string' ? input.applicationId : undefined;
      const apps = requested
        ? [applicationById(lists, requested)].flatMap(item => item ? [item] : [])
        : lists.applications;
      if (requested && apps.length === 0) {
        return deny(APPLICATIONS_STATUS, 'UNKNOWN_APPLICATION', 'That application is not on the allowlist.');
      }
      const applications = apps.map(app => ({
        id: app.id,
        displayName: app.displayName,
        installed: app.installed,
      }));
      return {
        capabilityId: APPLICATIONS_STATUS,
        status: 'ok',
        structured: { status: 'completed', applications, risk: 'READ_ONLY' },
        content: applications.map(app => `${app.displayName}: ${app.installed ? 'installed' : 'not_installed'}`).join(' · '),
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'read',
      };
    },
  };
}

function createRuntimeStatusHandler(services: JarvisServiceController, runtime?: RuntimeStatusPort): CapabilityHandler {
  return {
    descriptor: () => ({
      id: JARVIS_RUNTIME_STATUS,
      description: 'Structured Jarvis runtime health for Core, models, speech, memory, and lab.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      outputSchema: { type: 'object' },
      sideEffect: 'read',
      requiredService: 'jarvis',
      providerKind: 'local',
      timeoutMs: 6_000,
      untrustedOutput: false,
    }),
    availability: async () => ({ id: JARVIS_RUNTIME_STATUS, availability: 'up', degraded: false }),
    invoke: async () => {
      let snapshot: Awaited<ReturnType<JarvisServiceController['snapshot']>> = [];
      let registryReason: string | undefined;
      try {
        snapshot = await services.snapshot();
      } catch (error) {
        registryReason = error instanceof Error ? error.message : 'Service registry unavailable.';
      }
      const memory = runtime?.memoryAvailable?.()
        ?? fs.existsSync(path.join(process.cwd(), 'data', 'jarvis', 'jarvis.db'));
      const skills = runtime?.skillsAvailable?.() ?? true;
      const night = nightAgentSnapshot();
      const components = [
        { id: 'core', label: 'Core', health: 'healthy' as const, reason: 'Capability host is attached.' },
        ...(snapshot.length > 0
          ? snapshot.map(item => ({
            id: item.id,
            label: item.displayName,
            health: item.health,
            reason: item.reason,
          }))
          : [{
            id: 'services',
            label: 'Jarvis services',
            health: 'unavailable' as const,
            reason: registryReason || 'Service snapshot unavailable.',
          }]),
        { id: 'memory', label: 'Memory', health: memory ? 'healthy' as const : 'unavailable' as const, reason: memory ? undefined : 'SQLite memory file is not present.' },
        { id: 'capabilities', label: 'Capabilities', health: 'healthy' as const },
        { id: 'skills', label: 'Skills', health: skills ? 'healthy' as const : 'unavailable' as const },
        {
          id: 'night-agent',
          label: 'Night Agent',
          health: night.available ? 'healthy' as const : 'unavailable' as const,
          reason: night.available ? night.status : night.reason,
        },
      ];
      return {
        capabilityId: JARVIS_RUNTIME_STATUS,
        status: 'ok',
        structured: { status: 'completed', components, risk: 'READ_ONLY' },
        content: components.map(item => `${item.label} ${item.health}`).join(' · '),
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'read',
      };
    },
  };
}

function createHealthCheckHandler(services: JarvisServiceController): CapabilityHandler {
  return {
    descriptor: () => ({
      id: JARVIS_HEALTH_CHECK,
      description: 'Check registered Jarvis-owned services by serviceId.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: { serviceId: { type: 'string' } },
      },
      outputSchema: { type: 'object' },
      sideEffect: 'read',
      requiredService: 'jarvis',
      providerKind: 'local',
      timeoutMs: 5_000,
      untrustedOutput: false,
    }),
    availability: async () => ({ id: JARVIS_HEALTH_CHECK, availability: 'up', degraded: false }),
    invoke: async (input) => {
      const serviceId = typeof input.serviceId === 'string' ? input.serviceId : undefined;
      const ids = serviceId ? [serviceId] : JARVIS_SERVICE_CATALOG.map(item => item.id);
      const servicesStatus = [];
      for (const id of ids) {
        if (!isJarvisServiceId(id)) {
          return deny(JARVIS_HEALTH_CHECK, 'UNKNOWN_SERVICE', 'Unknown Jarvis service.');
        }
        const probe = await services.health(id);
        servicesStatus.push({
          id,
          displayName: serviceRecord(id)?.displayName || id,
          health: probe.health,
          lifecycle: probe.lifecycle,
          reason: probe.reason,
        });
      }
      return {
        capabilityId: JARVIS_HEALTH_CHECK,
        status: 'ok',
        structured: { status: 'completed', services: servicesStatus, risk: 'READ_ONLY' },
        content: servicesStatus.map(item => `${item.displayName} ${item.health}`).join(' · '),
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'read',
      };
    },
  };
}

function createStartHandler(services: JarvisServiceController): CapabilityHandler {
  return lifecycleHandler(JARVIS_START_SERVICE, 'Start a registered Jarvis-owned service by serviceId.', id => services.start(id));
}

function createStopHandler(services: JarvisServiceController): CapabilityHandler {
  return lifecycleHandler(JARVIS_STOP_SERVICE, 'Stop a registered Jarvis-owned service by serviceId.', id => services.stop(id));
}

function createRestartHandler(services: JarvisServiceController): CapabilityHandler {
  return lifecycleHandler(JARVIS_RESTART_SERVICE, 'Restart a registered Jarvis-owned service by serviceId.', id => services.restart(id));
}

function lifecycleHandler(
  id: string,
  description: string,
  run: (serviceId: string) => Promise<{ status: string; code: string; lifecycle: string; summary: string; health?: string }>,
): CapabilityHandler {
  return {
    descriptor: () => ({
      id,
      description,
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['serviceId'],
        properties: { serviceId: { type: 'string' } },
      },
      outputSchema: { type: 'object' },
      sideEffect: 'write',
      requiredService: 'jarvis',
      providerKind: 'local',
      timeoutMs: 8_000,
      untrustedOutput: false,
      effects: [{
        kind: 'SERVICE_CONTROL',
        description: `${id === JARVIS_START_SERVICE ? 'Start' : id === JARVIS_STOP_SERVICE ? 'Stop' : 'Restart'} one registered Jarvis-owned service.`,
        destructive: false,
        reversible: id !== JARVIS_RESTART_SERVICE,
        privilege: id === JARVIS_START_SERVICE ? 'standard_user' : 'owner_approval',
        riskLevel: id === JARVIS_START_SERVICE ? 'LOW' : 'MEDIUM',
        targetInputFields: ['serviceId'],
        estimatedAffectedObjects: 1,
      }],
      verification: {
        mode: 'structured_postcondition',
        description: 'Verify the service controller reported completed lifecycle execution.',
        structuredField: 'status',
        expectedValue: 'completed',
      },
      rollback: id === JARVIS_START_SERVICE
        ? { mode: 'manual_recovery', strategy: 'Stop the same registered service.', priorStateField: 'serviceId' }
        : { mode: 'manual_recovery', strategy: 'Restore the prior service lifecycle state.', priorStateField: 'priorLifecycle' },
    }),
    availability: async () => ({ id, availability: 'up', degraded: false }),
    invoke: async (input) => {
      const serviceId = String(input.serviceId ?? '');
      const result = await run(serviceId);
      const status = result.status === 'completed' ? 'ok' : result.status === 'unavailable' ? 'unavailable' : 'error';
      return {
        capabilityId: id,
        status,
        structured: {
          status: result.status === 'completed' ? 'completed' : result.status,
          reasonCode: result.code,
          lifecycle: result.lifecycle,
          health: result.health,
          risk: id === JARVIS_START_SERVICE ? 'LOW_RISK_ACTION' : 'CONFIRM_REQUIRED',
        },
        content: result.summary,
        sourceUrls: [],
        untrustedOutput: false,
        sideEffect: 'write',
        ...(result.status === 'completed' ? {} : { error: result.code }),
      };
    },
  };
}

function deny(capabilityId: string, reasonCode: string, content: string): CapabilityResult {
  return {
    capabilityId,
    status: 'rejected',
    structured: { status: 'denied', reasonCode, risk: 'BLOCKED' },
    content,
    sourceUrls: [],
    untrustedOutput: false,
    sideEffect: 'read',
    error: reasonCode,
  };
}

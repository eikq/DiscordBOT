import { McpResearchGateway } from '../../bot/research/McpResearchGateway';
import { systemHealthSnapshot } from '../standalone/labSystem';
import {
  ActionAuditLog,
  ConfirmationStore,
  PermissionPolicy,
  WindowsDesktopActionAdapter,
  createActionGate,
  defaultActionAuditPath,
  loadDesktopAllowlists,
  registerDesktopCapabilities,
  type ActionGateOptions,
  type DesktopActionAdapter,
  type DesktopAllowlists,
  type SystemStatusPort,
} from './actions';
import type { ReminderCapabilityDeps } from '../automation/reminderCapabilities';
import { registerReminderCapabilities } from '../automation/reminderCapabilities';
import type { ResearchCapabilityDeps } from '../research/researchCapabilities';
import { registerResearchCapabilities } from '../research/researchCapabilities';
import { PrivateResearchGateway } from '../research/private/privateGateway';
import { PrivilegeLeaseStore } from '../security/privilegeLease';
import { sharedJarvisEventBus } from '../security/eventBus';
import type { JarvisEventBus } from '../security/eventBus';
import type { WorkspaceCapabilityDeps } from '../workspace/workspaceCapabilities';
import { registerWorkspaceCapabilities } from '../workspace/workspaceCapabilities';
import { registerRuntimeCapabilities } from './actions/runtimeCapabilities';
import { sharedJarvisServiceController, type JarvisServiceController } from './actions/services';
import { CapabilityRegistry } from './CapabilityRegistry';
import { createLabPingHandler } from './labPing';
import { registerWorldIntelCapabilities, type WorldIntelCapabilityPort } from './worldIntel';
import type { CapabilityHost } from './types';

export type StandaloneCapabilityHostOptions = {
  worldIntel?: WorldIntelCapabilityPort | false;
  reminders?: ReminderCapabilityDeps | false;
  research?: ResearchCapabilityDeps | false;
  workspace?: WorkspaceCapabilityDeps | false;
  actions?: false | {
    allowlists?: DesktopAllowlists;
    adapter?: DesktopActionAdapter;
    policy?: PermissionPolicy | null;
    confirmations?: ConfirmationStore;
    audit?: ActionAuditLog | false;
    systemStatus?: SystemStatusPort;
    now?: () => number;
    services?: JarvisServiceController;
    leases?: PrivilegeLeaseStore;
    events?: JarvisEventBus;
  };
};

export function createStandaloneCapabilityHost(
  options: StandaloneCapabilityHostOptions = {},
): CapabilityHost {
  const registry = new CapabilityRegistry();
  registry.register(createLabPingHandler());

  let allowlists: DesktopAllowlists | undefined;
  if (options.actions !== false) {
    allowlists = options.actions?.allowlists ?? loadDesktopAllowlists();
    const adapter = options.actions?.adapter ?? new WindowsDesktopActionAdapter(allowlists);
    registerDesktopCapabilities(registry, {
      adapter,
      allowlists,
      systemStatus: options.actions?.systemStatus ?? { snapshot: systemHealthSnapshot },
    });
    try {
      registerRuntimeCapabilities(registry, {
        allowlists,
        services: options.actions?.services ?? sharedJarvisServiceController(),
      });
    } catch (error) {
      console.warn(`[Jarvis] Runtime capabilities unavailable: ${error instanceof Error ? error.message : error}`);
    }
    if (options.reminders !== false) {
      try {
        registerReminderCapabilities(registry, options.reminders ?? {});
      } catch (error) {
        console.warn(`[Jarvis] Reminder capabilities unavailable: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  if (options.worldIntel !== false) {
    const port = options.worldIntel ?? worldIntelPortFromGateway(new McpResearchGateway());
    registerWorldIntelCapabilities(registry, port);
  }

  if (options.research !== false) {
    try {
      const research = options.research ?? {};
      registerResearchCapabilities(registry, {
        ...research,
        privateGateway: research.privateGateway ?? new PrivateResearchGateway({
          bus: options.actions === false ? undefined : options.actions?.events ?? sharedJarvisEventBus(),
        }),
      });
    } catch (error) {
      console.warn(`[Jarvis] Research capabilities unavailable: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (options.workspace !== false) {
    try {
      registerWorkspaceCapabilities(registry, options.workspace ?? {});
    } catch (error) {
      console.warn(`[Jarvis] Workspace capabilities unavailable: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (options.actions === false || !allowlists) return registry;

  const gateOptions: ActionGateOptions = {
    allowlists,
    policy: options.actions?.policy === undefined ? new PermissionPolicy() : options.actions.policy,
    confirmations: options.actions?.confirmations,
    audit: options.actions?.audit === false
      ? undefined
      : options.actions?.audit ?? new ActionAuditLog(defaultActionAuditPath()),
    now: options.actions?.now,
    services: options.actions?.services ?? sharedJarvisServiceController(),
    leases: options.actions?.leases ?? new PrivilegeLeaseStore(),
    events: options.actions?.events ?? sharedJarvisEventBus(),
  };
  return createActionGate(registry, gateOptions);
}

export function worldIntelPortFromGateway(gateway: McpResearchGateway): WorldIntelCapabilityPort {
  return {
    execute: call => gateway.execute(call),
    getStatus: async () => {
      const status = await gateway.getStatus();
      return {
        availability: status.availability,
        error: status.error,
        allowedTools: status.allowedTools,
      };
    },
  };
}

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
import { SessionWebGrantStore } from '../desktop/sessionWebGrants';
import type { ReminderCapabilityDeps } from '../automation/reminderCapabilities';
import { REMINDER_CREATE_VERIFIER_ID, createReminderRecordVerifier, registerReminderCapabilities } from '../automation/reminderCapabilities';
import type { ResearchCapabilityDeps } from '../research/researchCapabilities';
import { registerResearchCapabilities } from '../research/researchCapabilities';
import { PrivateResearchGateway } from '../research/private/privateGateway';
import { PrivilegeLeaseStore } from '../security/privilegeLease';
import { sharedJarvisEventBus } from '../security/eventBus';
import type { JarvisEventBus } from '../security/eventBus';
import type { EmergencyStopController } from '../security/emergencyStop';
import type { FailureContainment } from '../safety/failureContainment';
import { sharedTrustedOperatorRuntime, TrustedOperatorRuntime } from '../security/trustedOperatorRuntime';
import type { WorkspaceCapabilityDeps } from '../workspace/workspaceCapabilities';
import { registerWorkspaceCapabilities } from '../workspace/workspaceCapabilities';
import { registerRuntimeCapabilities } from './actions/runtimeCapabilities';
import { sharedJarvisServiceController, type JarvisServiceController } from './actions/services';
import { CapabilityRegistry } from './CapabilityRegistry';
import { createLabPingHandler } from './labPing';
import { registerWorldIntelCapabilities, type WorldIntelCapabilityPort } from './worldIntel';
import type { CapabilityHost } from './types';
import { registerRecoverySandboxCapabilities } from '../recovery';
import { defaultRuntimeRoot } from '../storage/operationalDb';
import { registerSoftwareCapabilities } from '../build/capabilities';
import { BuildPlanStore } from '../build/planStore';
import { openMigratedDatabase } from '../../bot/memory/jarvis/migrate';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

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
    emergency?: EmergencyStopController;
    containment?: FailureContainment;
    /** Enables the real checkpoint-backed acceptance sandbox under this Jarvis-owned root. */
    recoveryRoot?: string;
    operator?: TrustedOperatorRuntime;
    displayAliases?: ActionGateOptions['displayAliases'];
  };
  build?: false | { db?: DatabaseSync; sandboxRoot?: string };
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
      displayAliases: options.actions?.displayAliases,
    });
    if (adapter instanceof WindowsDesktopActionAdapter) {
      void import('../desktop/windowsDisplayHost').then(mod => {
        void mod.ensureDesktopHostAssembly();
      });
    }
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

  if (options.build !== false) {
    try {
      const db = options.build?.db ?? defaultSoftwareDatabase();
      registerSoftwareCapabilities(registry, {
        plans: new BuildPlanStore(db),
        events: options.actions === false ? undefined : options.actions?.events ?? sharedJarvisEventBus(),
        sandboxRoot: options.build?.sandboxRoot,
      });
    } catch (error) {
      console.warn(`[Jarvis] Software capabilities unavailable: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (options.actions === false || !allowlists) return registry;

  const operator = options.actions?.operator ?? (options.actions?.leases || options.actions?.events || options.actions?.now || options.actions?.recoveryRoot
    ? new TrustedOperatorRuntime({
        leases: options.actions?.leases,
        events: options.actions?.events ?? sharedJarvisEventBus(),
        now: options.actions?.now,
        runtimeRoot: options.actions?.recoveryRoot,
      })
    : sharedTrustedOperatorRuntime());

  if (operator.checkpoints) {
    const recoveryRoot = options.actions?.recoveryRoot
      ?? process.env.JARVIS_RUNTIME_DIR
      ?? defaultRuntimeRoot();
    registerRecoverySandboxCapabilities(registry, {
      root: recoveryRoot,
      checkpoints: operator.checkpoints,
      verification: operator.verification,
      events: options.actions?.events ?? operator.events,
      now: options.actions?.now,
      journal: operator.journal,
    });
  }
  if (options.reminders !== false && options.reminders?.store && !operator.verification.has(REMINDER_CREATE_VERIFIER_ID)) {
    operator.verification.register(REMINDER_CREATE_VERIFIER_ID, createReminderRecordVerifier(options.reminders));
  }

  const sessionWebGrants = new SessionWebGrantStore();
  const gateOptions: ActionGateOptions = {
    allowlists,
    sessionWebGrants,
    policy: options.actions?.policy === undefined
      ? new PermissionPolicy({ sessionWebGrants })
      : options.actions.policy,
    confirmations: options.actions?.confirmations,
    audit: options.actions?.audit === false
      ? undefined
      : options.actions?.audit ?? new ActionAuditLog(defaultActionAuditPath()),
    now: options.actions?.now,
    services: options.actions?.services ?? sharedJarvisServiceController(),
    leases: options.actions?.leases ?? operator.leases,
    events: options.actions?.events ?? operator.events,
    emergency: options.actions?.emergency ?? operator.emergency,
    containment: options.actions?.containment ?? operator.containment,
    verification: operator.verification,
    journal: operator.journal,
    displayAliases: options.actions?.displayAliases,
  };
  return createActionGate(registry, gateOptions);
}

let softwareDb: DatabaseSync | undefined;

function defaultSoftwareDatabase(): DatabaseSync {
  if (softwareDb) return softwareDb;
  softwareDb = openMigratedDatabase(path.join(os.tmpdir(), `jarvis-software-${process.pid}.sqlite`));
  return softwareDb;
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

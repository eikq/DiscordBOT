import path from 'node:path';
import { FailureContainment } from '../safety/failureContainment';
import { defaultRuntimeRoot } from '../storage/operationalDb';
import { EmergencyStopController } from './emergencyStop';
import { sharedJarvisEventBus, type JarvisEventBus } from './eventBus';
import { PrivilegeLeaseStore } from './privilegeLease';
import { PersistentPermissionStore, defaultPersistentPermissionPath } from './persistentPermission';
import { RecoveryCheckpointStore } from '../recovery';
import { ExecutionJournalCoordinator } from '../executionJournal';
import { VerificationRegistry } from '../safety/verificationRegistry';
import { DevServerRegistry } from '../project/devServer';

export type TrustedOperatorRuntimeOptions = {
  events?: JarvisEventBus;
  leases?: PrivilegeLeaseStore;
  permissions?: PersistentPermissionStore;
  now?: () => number;
  emergencyPersistPath?: string;
  runtimeRoot?: string;
};

export type TrustedOperatorSnapshot = {
  emergency: ReturnType<EmergencyStopController['snapshot']>;
  leases: ReturnType<PrivilegeLeaseStore['listInventory']>;
  containment: ReturnType<FailureContainment['list']>;
  checkpoints: ReturnType<RecoveryCheckpointStore['list']>;
  journalActive: number;
  journalFailClosed: boolean;
};

export class TrustedOperatorRuntime {
  public readonly events: JarvisEventBus;
  public readonly leases: PrivilegeLeaseStore;
  public readonly permissions?: PersistentPermissionStore;
  public readonly emergency: EmergencyStopController;
  public readonly containment: FailureContainment;
  public readonly checkpoints?: RecoveryCheckpointStore;
  public readonly verification: VerificationRegistry;
  public readonly journal?: ExecutionJournalCoordinator;
  public readonly devServers?: DevServerRegistry;

  public constructor(options: TrustedOperatorRuntimeOptions = {}) {
    this.events = options.events ?? sharedJarvisEventBus();
    this.verification = new VerificationRegistry();
    this.leases = options.leases ?? new PrivilegeLeaseStore({ now: options.now, events: this.events });
    const runtimeRoot = options.runtimeRoot;
    this.permissions = options.permissions ?? (runtimeRoot
      ? new PersistentPermissionStore({
          dbPath: defaultPersistentPermissionPath(runtimeRoot),
          now: options.now,
        })
      : undefined);
    this.devServers = runtimeRoot
      ? new DevServerRegistry({
          persistPath: path.join(runtimeRoot, 'dev-servers.json'),
          now: options.now,
        })
      : undefined;
    this.emergency = new EmergencyStopController({
      leases: this.leases,
      events: this.events,
      now: options.now,
      persistPath: options.emergencyPersistPath ?? (options.runtimeRoot ? path.join(options.runtimeRoot, 'security', 'emergency-stop.json') : undefined),
      onEngage: actor => {
        if (!this.journal || this.journal.failClosed()) return;
        for (const record of this.journal.discoverActive()) {
          this.journal.markEmergencyStop(record.operationId, actor);
        }
      },
      onResume: actor => {
        this.journal?.noteEmergencyResume(actor);
      },
    });
    this.containment = new FailureContainment(
      this.events,
      options.now,
      options.runtimeRoot ? path.join(options.runtimeRoot, 'recovery', 'containment.json') : undefined,
    );
    this.checkpoints = options.runtimeRoot
      ? new RecoveryCheckpointStore(path.join(options.runtimeRoot, 'recovery', 'checkpoints'), options.now)
      : undefined;
    this.journal = options.runtimeRoot
      ? new ExecutionJournalCoordinator({
          dbPath: path.join(options.runtimeRoot, 'execution-journal.db'),
          now: options.now,
          checkpoints: this.checkpoints,
          containment: this.containment,
          events: this.events,
        })
      : undefined;
  }

  public snapshot(): TrustedOperatorSnapshot {
    return {
      emergency: this.emergency.snapshot(),
      leases: this.leases.listInventory(),
      containment: this.containment.list(),
      checkpoints: this.checkpoints?.list() ?? [],
      journalActive: this.journal && !this.journal.failClosed() ? this.journal.discoverActive().length : 0,
      journalFailClosed: this.journal?.failClosed() === true,
    };
  }
}

let sharedRuntime: TrustedOperatorRuntime | undefined;

export function sharedTrustedOperatorRuntime(): TrustedOperatorRuntime {
  const events = sharedJarvisEventBus();
  sharedRuntime ??= new TrustedOperatorRuntime({
    events,
    runtimeRoot: process.env.JARVIS_RUNTIME_DIR || defaultRuntimeRoot(),
  });
  return sharedRuntime;
}

export function resetSharedTrustedOperatorRuntime(): void {
  sharedRuntime = undefined;
}

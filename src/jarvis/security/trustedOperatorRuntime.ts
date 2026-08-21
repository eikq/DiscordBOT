import path from 'node:path';
import { FailureContainment } from '../safety/failureContainment';
import { defaultRuntimeRoot } from '../storage/operationalDb';
import { EmergencyStopController } from './emergencyStop';
import { sharedJarvisEventBus, type JarvisEventBus } from './eventBus';
import { PrivilegeLeaseStore } from './privilegeLease';
import { RecoveryCheckpointStore } from '../recovery';
import { VerificationRegistry } from '../safety/verificationRegistry';

export type TrustedOperatorRuntimeOptions = {
  events?: JarvisEventBus;
  leases?: PrivilegeLeaseStore;
  now?: () => number;
  emergencyPersistPath?: string;
  runtimeRoot?: string;
};

export type TrustedOperatorSnapshot = {
  emergency: ReturnType<EmergencyStopController['snapshot']>;
  leases: ReturnType<PrivilegeLeaseStore['listInventory']>;
  containment: ReturnType<FailureContainment['list']>;
  checkpoints: ReturnType<RecoveryCheckpointStore['list']>;
};

export class TrustedOperatorRuntime {
  public readonly events: JarvisEventBus;
  public readonly leases: PrivilegeLeaseStore;
  public readonly emergency: EmergencyStopController;
  public readonly containment: FailureContainment;
  public readonly checkpoints?: RecoveryCheckpointStore;
  public readonly verification: VerificationRegistry;

  public constructor(options: TrustedOperatorRuntimeOptions = {}) {
    this.events = options.events ?? sharedJarvisEventBus();
    this.verification = new VerificationRegistry();
    this.leases = options.leases ?? new PrivilegeLeaseStore({ now: options.now, events: this.events });
    this.emergency = new EmergencyStopController({
      leases: this.leases,
      events: this.events,
      now: options.now,
      persistPath: options.emergencyPersistPath ?? (options.runtimeRoot ? path.join(options.runtimeRoot, 'security', 'emergency-stop.json') : undefined),
    });
    this.containment = new FailureContainment(
      this.events,
      options.now,
      options.runtimeRoot ? path.join(options.runtimeRoot, 'recovery', 'containment.json') : undefined,
    );
    this.checkpoints = options.runtimeRoot
      ? new RecoveryCheckpointStore(path.join(options.runtimeRoot, 'recovery', 'checkpoints'), options.now)
      : undefined;
  }

  public snapshot(): TrustedOperatorSnapshot {
    return {
      emergency: this.emergency.snapshot(),
      leases: this.leases.listInventory(),
      containment: this.containment.list(),
      checkpoints: this.checkpoints?.list() ?? [],
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

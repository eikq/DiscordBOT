import path from 'node:path';
import { FailureContainment } from '../safety/failureContainment';
import { defaultRuntimeRoot } from '../storage/operationalDb';
import { EmergencyStopController } from './emergencyStop';
import { sharedJarvisEventBus, type JarvisEventBus } from './eventBus';
import { PrivilegeLeaseStore } from './privilegeLease';

export type TrustedOperatorRuntimeOptions = {
  events?: JarvisEventBus;
  leases?: PrivilegeLeaseStore;
  now?: () => number;
  emergencyPersistPath?: string;
};

export type TrustedOperatorSnapshot = {
  emergency: ReturnType<EmergencyStopController['snapshot']>;
  leases: ReturnType<PrivilegeLeaseStore['listInventory']>;
  containment: ReturnType<FailureContainment['list']>;
};

export class TrustedOperatorRuntime {
  public readonly events: JarvisEventBus;
  public readonly leases: PrivilegeLeaseStore;
  public readonly emergency: EmergencyStopController;
  public readonly containment: FailureContainment;

  public constructor(options: TrustedOperatorRuntimeOptions = {}) {
    this.events = options.events ?? sharedJarvisEventBus();
    this.leases = options.leases ?? new PrivilegeLeaseStore({ now: options.now, events: this.events });
    this.emergency = new EmergencyStopController({
      leases: this.leases,
      events: this.events,
      now: options.now,
      persistPath: options.emergencyPersistPath,
    });
    this.containment = new FailureContainment(this.events, options.now);
  }

  public snapshot(): TrustedOperatorSnapshot {
    return {
      emergency: this.emergency.snapshot(),
      leases: this.leases.listInventory(),
      containment: this.containment.list(),
    };
  }
}

let sharedRuntime: TrustedOperatorRuntime | undefined;

export function sharedTrustedOperatorRuntime(): TrustedOperatorRuntime {
  const events = sharedJarvisEventBus();
  sharedRuntime ??= new TrustedOperatorRuntime({
    events,
    emergencyPersistPath: path.join(
      process.env.JARVIS_RUNTIME_DIR || defaultRuntimeRoot(),
      'security',
      'emergency-stop.json',
    ),
  });
  return sharedRuntime;
}

export function resetSharedTrustedOperatorRuntime(): void {
  sharedRuntime = undefined;
}

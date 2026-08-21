import fs from 'node:fs';
import path from 'node:path';
import type { ActionSource } from '../capabilities/actions/types';
import type { CapabilitySideEffect } from '../capabilities/types';
import type { JarvisEventBus } from './eventBus';
import type { PrivilegeLeaseStore } from './privilegeLease';
import { redactSecrets } from './redaction';

export type EmergencyCancellationState =
  | 'CANCELLED'
  | 'CANCELLATION_REQUESTED'
  | 'NOT_CANCELLABLE'
  | 'UNKNOWN';

export type EmergencyCancellationResult = {
  ownerId: string;
  workId: string;
  state: EmergencyCancellationState;
  detail: string;
};

export type EmergencyStopSnapshot = {
  active: boolean;
  engagedAt?: string;
  engagedBy?: 'owner' | 'system';
  reason?: string;
  resumedAt?: string;
  revokedLeaseIds: string[];
  cancellations: EmergencyCancellationResult[];
};

export type EmergencyStopParticipant = {
  id: string;
  cancelForEmergency(): EmergencyCancellationResult[];
};

export type EmergencyStopOptions = {
  leases: PrivilegeLeaseStore;
  events?: JarvisEventBus;
  now?: () => number;
  persistPath?: string;
};

/**
 * Process-local execution interlock with an optional restart-persistent latch.
 * Models and Jarvis/system actors can engage it, but only the owner can clear it.
 */
export class EmergencyStopController {
  private readonly participants = new Map<string, EmergencyStopParticipant>();
  private readonly now: () => number;
  private state: EmergencyStopSnapshot = { active: false, revokedLeaseIds: [], cancellations: [] };

  public constructor(private readonly options: EmergencyStopOptions) {
    this.now = options.now ?? (() => Date.now());
    this.load();
    if (this.state.active) {
      this.options.leases.suspendIssuance('Emergency Stop is active. Only the owner can resume operation.');
    }
  }

  public register(participant: EmergencyStopParticipant): () => void {
    this.participants.set(participant.id, participant);
    return () => {
      if (this.participants.get(participant.id) === participant) this.participants.delete(participant.id);
    };
  }

  public engage(actor: 'owner' | 'system', reason: string): EmergencyStopSnapshot {
    if (this.state.active) return this.snapshot();
    const engagedAt = new Date(this.now()).toISOString();
    this.state = {
      active: true,
      engagedAt,
      engagedBy: actor,
      reason: bounded(redactSecrets(reason.trim() || 'Emergency Stop activated.'), 240),
      revokedLeaseIds: [],
      cancellations: [],
    };
    // Set and persist the latch before asking other components to stop.
    this.persist();
    this.options.leases.suspendIssuance('Emergency Stop is active. Only the owner can resume operation.');
    this.state.revokedLeaseIds = this.options.leases.revokeAll('system').map(item => item.id);
    this.state.cancellations = [...this.participants.values()].flatMap(participant => {
      try {
        return participant.cancelForEmergency();
      } catch (error) {
        return [{
          ownerId: participant.id,
          workId: participant.id,
          state: 'UNKNOWN' as const,
          detail: error instanceof Error ? error.message.slice(0, 180) : 'Cancellation participant failed.',
        }];
      }
    });
    this.persist();
    this.options.events?.emit('EMERGENCY_STOP', 'Emergency Stop engaged; new autonomous execution is blocked.', {
      actor,
      revokedLeaseCount: this.state.revokedLeaseIds.length,
      cancellationStates: summarizeCancellations(this.state.cancellations),
    }, 'error');
    return this.snapshot();
  }

  public resume(actor: 'owner' | 'jarvis' | 'model' | 'system', reason: string): EmergencyStopSnapshot {
    if (actor !== 'owner') {
      throw Object.assign(new Error('Only an explicit owner action may clear Emergency Stop.'), {
        reasonCode: 'OWNER_RESUME_REQUIRED',
      });
    }
    if (!this.state.active) return this.snapshot();
    if (!this.options.leases.resumeIssuance('owner')) {
      throw Object.assign(new Error('Privilege lease issuance could not be resumed.'), {
        reasonCode: 'LEASE_RESUME_FAILED',
      });
    }
    this.state = {
      ...this.state,
      active: false,
      resumedAt: new Date(this.now()).toISOString(),
      reason: bounded(redactSecrets(reason.trim() || 'Owner resumed operation.'), 240),
    };
    this.persist();
    this.options.events?.emit('EMERGENCY_RESUME', 'Owner explicitly resumed autonomous execution.', {
      resumedAt: this.state.resumedAt,
    }, 'warn');
    return this.snapshot();
  }

  public allows(source: ActionSource, sideEffect: CapabilitySideEffect): boolean {
    if (!this.state.active) return true;
    return source === 'ui' && sideEffect === 'read';
  }

  public snapshot(): EmergencyStopSnapshot {
    return {
      ...this.state,
      revokedLeaseIds: [...this.state.revokedLeaseIds],
      cancellations: this.state.cancellations.map(item => ({ ...item })),
    };
  }

  private load(): void {
    const file = this.options.persistPath;
    if (!file || !fs.existsSync(file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<EmergencyStopSnapshot>;
      if (parsed.active !== true) return;
      this.state = {
        active: true,
        engagedAt: typeof parsed.engagedAt === 'string' ? parsed.engagedAt : undefined,
        engagedBy: parsed.engagedBy === 'owner' || parsed.engagedBy === 'system' ? parsed.engagedBy : 'system',
        reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : 'Recovered active Emergency Stop latch.',
        revokedLeaseIds: Array.isArray(parsed.revokedLeaseIds) ? parsed.revokedLeaseIds.filter(isString).slice(0, 200) : [],
        cancellations: [],
      };
    } catch {
      // Corrupt state fails closed: a manual owner resume is required.
      this.state = {
        active: true,
        engagedBy: 'system',
        reason: 'Emergency Stop state could not be read safely; execution remains blocked.',
        revokedLeaseIds: [],
        cancellations: [],
      };
    }
  }

  private persist(): void {
    const file = this.options.persistPath;
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
  }
}

function summarizeCancellations(items: EmergencyCancellationResult[]): Record<EmergencyCancellationState, number> {
  const result: Record<EmergencyCancellationState, number> = {
    CANCELLED: 0,
    CANCELLATION_REQUESTED: 0,
    NOT_CANCELLABLE: 0,
    UNKNOWN: 0,
  };
  for (const item of items) result[item.state] += 1;
  return result;
}

function bounded(value: string, max: number): string {
  return value.slice(0, max);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

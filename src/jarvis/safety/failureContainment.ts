import { randomUUID } from 'node:crypto';
import type { CapabilityResult } from '../capabilities/types';
import type { JarvisEventBus } from '../security/eventBus';
import type { PrivilegeActor } from '../security/types';
import { redactSecrets } from '../security/redaction';
import type { ActionPreflight, RollbackContract } from './types';

export type ContainmentIncident = {
  id: string;
  createdAt: string;
  taskId?: string;
  stepId?: string;
  capabilityId: string;
  requestedAction: string;
  actualObservedResult: string;
  affectedTargets: string[];
  evidence: string[];
  recovery: RollbackContract;
  active: boolean;
  reasonCode: 'DESTRUCTIVE_EXECUTION_FAILED' | 'EFFECT_SCOPE_MISMATCH';
  clearedAt?: string;
};

export class FailureContainment {
  private readonly incidents = new Map<string, ContainmentIncident>();

  public constructor(
    private readonly events?: JarvisEventBus,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public blocks(capabilityId: string, preflight: ActionPreflight): ContainmentIncident | undefined {
    return [...this.incidents.values()].find(incident => {
      if (!incident.active || incident.capabilityId !== capabilityId) return false;
      if (incident.affectedTargets.length === 0 || preflight.affectedTargets.length === 0) return true;
      return incident.affectedTargets.some(target => preflight.affectedTargets.includes(target));
    });
  }

  public observe(input: {
    capabilityId: string;
    preflight: ActionPreflight;
    result: CapabilityResult;
    recovery: RollbackContract;
    taskId?: string;
    stepId?: string;
  }): ContainmentIncident | undefined {
    const destructive = input.preflight.effects.some(effect => effect.destructive);
    const actualTargets = structuredTargets(input.result.structured.affectedTargets);
    const outsideScope = actualTargets.filter(target => !input.preflight.affectedTargets.includes(target));
    const failedAfterDestructive = destructive && input.result.status !== 'ok';
    if (!failedAfterDestructive && outsideScope.length === 0) return undefined;

    const incident: ContainmentIncident = {
      id: `containment_${randomUUID()}`,
      createdAt: new Date(this.now()).toISOString(),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.stepId ? { stepId: input.stepId } : {}),
      capabilityId: input.capabilityId,
      requestedAction: input.preflight.action,
      actualObservedResult: input.result.error || input.result.status,
      affectedTargets: actualTargets.length ? actualTargets : [...input.preflight.affectedTargets],
      evidence: failedAfterDestructive
        ? [`Capability returned ${input.result.status} after a declared destructive effect began.`]
        : ['Handler-reported affected targets exceeded the preflight scope.'],
      recovery: { ...input.recovery },
      active: true,
      reasonCode: failedAfterDestructive ? 'DESTRUCTIVE_EXECUTION_FAILED' : 'EFFECT_SCOPE_MISMATCH',
    };
    this.incidents.set(incident.id, incident);
    this.events?.emit('FAILURE_CONTAINED', 'Further related mutation was stopped after an unexpected action result.', {
      incidentId: incident.id,
      capabilityId: incident.capabilityId,
      reasonCode: incident.reasonCode,
      affectedTargetCount: incident.affectedTargets.length,
      recoveryState: incident.recovery.state,
    }, 'error', { taskId: incident.taskId });
    return this.clone(incident);
  }

  public clear(id: string, actor: PrivilegeActor): boolean {
    if (actor !== 'owner') return false;
    const incident = this.incidents.get(id);
    if (!incident) return false;
    incident.active = false;
    incident.clearedAt = new Date(this.now()).toISOString();
    return true;
  }

  public list(): ContainmentIncident[] {
    return [...this.incidents.values()].map(item => this.clone(item));
  }

  private clone(item: ContainmentIncident): ContainmentIncident {
    return {
      ...item,
      affectedTargets: [...item.affectedTargets],
      evidence: [...item.evidence],
      recovery: { ...item.recovery },
    };
  }
}

function structuredTargets(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => sanitizeTarget(item))
    .slice(0, 100);
}

function sanitizeTarget(value: string): string {
  const redacted = redactSecrets(value).slice(0, 512);
  try {
    const url = new URL(redacted);
    if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.origin}${url.pathname}`.slice(0, 512);
  } catch {
    // Not a URL.
  }
  return redacted;
}

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CapabilityResult } from '../capabilities/types';
import type { JarvisEventBus } from '../security/eventBus';
import type { PrivilegeActor } from '../security/types';
import { redactSecrets } from '../security/redaction';
import { isExpectedNoMutationOutcome } from './containmentReconcile';
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
  reasonCode: 'DESTRUCTIVE_EXECUTION_FAILED' | 'EFFECT_SCOPE_MISMATCH' | 'MUTATION_OUTCOME_UNKNOWN' | 'CONTAINMENT_STATE_CORRUPT';
  clearedAt?: string;
};

export class FailureContainment {
  private readonly incidents = new Map<string, ContainmentIncident>();

  public constructor(
    private readonly events?: JarvisEventBus,
    private readonly now: () => number = () => Date.now(),
    private readonly persistPath?: string,
  ) {
    this.load();
  }

  public blocks(capabilityId: string, preflight: ActionPreflight): ContainmentIncident | undefined {
    return [...this.incidents.values()].find(incident => {
      if (!incident.active || (incident.capabilityId !== '*' && incident.capabilityId !== capabilityId)) return false;
      if (incident.affectedTargets.length === 0) {
        return incident.reasonCode === 'MUTATION_OUTCOME_UNKNOWN'
          || incident.reasonCode === 'CONTAINMENT_STATE_CORRUPT'
          || incident.reasonCode === 'DESTRUCTIVE_EXECUTION_FAILED';
      }
      if (preflight.affectedTargets.length === 0) {
        return incident.capabilityId === capabilityId || incident.capabilityId === '*';
      }
      return incident.affectedTargets.some(target => preflight.affectedTargets.includes(target));
    });
  }

  public listActive(capabilityId?: string): ContainmentIncident[] {
    return this.list().filter(item => item.active && (!capabilityId || item.capabilityId === capabilityId || item.capabilityId === '*'));
  }

  public get(id: string): ContainmentIncident | undefined {
    const incident = this.incidents.get(id);
    return incident ? this.clone(incident) : undefined;
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
    const outsideScope = actualTargets.filter(target => (
      !input.preflight.affectedTargets.includes(target)
      && !isDiscoveredWindowRefinement(target, input.preflight.affectedTargets)
    ));
    const failedAfterDestructive = destructive && input.result.status !== 'ok';
    const mutationOutcomeUnknown = input.preflight.effects.some(effect => effect.kind !== 'READ')
      && (input.result.status === 'timeout'
        || input.result.structured.reasonCode === 'MUTATION_OUTCOME_UNKNOWN'
        || cancellationState(input.result.structured.cancellation) === 'FAILED_TO_CANCEL'
        || cancellationState(input.result.structured.cancellation) === 'CANCELLATION_REQUESTED');
    if (isExpectedNoMutationOutcome(input.result)) return undefined;
    if (!failedAfterDestructive && outsideScope.length === 0 && !mutationOutcomeUnknown) return undefined;

    const reasonCode = outsideScope.length > 0
      ? 'EFFECT_SCOPE_MISMATCH' as const
      : mutationOutcomeUnknown
        ? 'MUTATION_OUTCOME_UNKNOWN' as const
        : 'DESTRUCTIVE_EXECUTION_FAILED' as const;

    const incident: ContainmentIncident = {
      id: `containment_${randomUUID()}`,
      createdAt: new Date(this.now()).toISOString(),
      ...(input.taskId ? { taskId: input.taskId } : {}),
      ...(input.stepId ? { stepId: input.stepId } : {}),
      capabilityId: input.capabilityId,
      requestedAction: redactSecrets(input.preflight.action).slice(0, 512),
      actualObservedResult: redactSecrets(input.result.error || input.result.status).slice(0, 512),
      affectedTargets: actualTargets.length ? actualTargets : [...input.preflight.affectedTargets],
      evidence: reasonCode === 'MUTATION_OUTCOME_UNKNOWN'
        ? ['A mutating handler timed out or did not acknowledge a safe cancellation; partial effects are unknown.']
        : failedAfterDestructive
          ? [`Capability returned ${input.result.status} after a declared destructive effect began.`]
          : ['Handler-reported affected targets exceeded the preflight scope.'],
      recovery: sanitizeRecovery(input.recovery),
      active: true,
      reasonCode,
    };
    this.incidents.set(incident.id, incident);
    this.persist();
    this.events?.emit('FAILURE_CONTAINED', 'Further related mutation was stopped after an unexpected action result.', {
      incidentId: incident.id,
      capabilityId: incident.capabilityId,
      reasonCode: incident.reasonCode,
      affectedTargetCount: incident.affectedTargets.length,
      recoveryState: incident.recovery.state,
    }, 'error', { taskId: incident.taskId });
    this.events?.emit('CONTAINMENT_ACTIVATED', 'Scoped fail-closed containment is active.', {
      incidentId: incident.id,
      capabilityId: incident.capabilityId,
      reasonCode: incident.reasonCode,
      affectedTargets: incident.affectedTargets,
    }, 'error', { taskId: incident.taskId });
    return this.clone(incident);
  }

  public clear(id: string, actor: PrivilegeActor): boolean {
    if (actor !== 'owner') return false;
    const incident = this.incidents.get(id);
    if (!incident) return false;
    incident.active = false;
    incident.clearedAt = new Date(this.now()).toISOString();
    this.persist();
    this.events?.emit('CONTAINMENT_CLEARED', 'Owner cleared scoped failure containment.', {
      incidentId: incident.id,
      capabilityId: incident.capabilityId,
    }, 'warn', { taskId: incident.taskId });
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

  private load(): void {
    if (!this.persistPath || !fs.existsSync(this.persistPath)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.persistPath, 'utf8')) as { version?: number; incidents?: ContainmentIncident[] };
      if (parsed.version !== 1 || !Array.isArray(parsed.incidents)) throw new Error('Invalid containment inventory.');
      for (const item of parsed.incidents) {
        if (validIncident(item)) this.incidents.set(item.id, this.clone(item));
      }
    } catch {
      const incident: ContainmentIncident = {
        id: `containment_${randomUUID()}`,
        createdAt: new Date(this.now()).toISOString(),
        capabilityId: '*',
        requestedAction: 'Recover containment inventory',
        actualObservedResult: 'Persistent containment state could not be read safely.',
        affectedTargets: [],
        evidence: ['Containment inventory failed structural validation.'],
        recovery: { state: 'UNAVAILABLE', strategy: 'Owner review is required before mutation resumes.' },
        active: true,
        reasonCode: 'CONTAINMENT_STATE_CORRUPT',
      };
      this.incidents.set(incident.id, incident);
    }
  }

  private persist(): void {
    if (!this.persistPath) return;
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    const temp = `${this.persistPath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ version: 1, incidents: this.list() }, null, 2), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, this.persistPath);
  }
}

function isDiscoveredWindowRefinement(target: string, preflightTargets: string[]): boolean {
  if (!target.startsWith('window:')) return false;
  return preflightTargets.some(item => (
    item.startsWith('http://')
    || item.startsWith('https://')
    || item.startsWith('application:')
    || item.startsWith('window:')
    || /^[0-9]{1,20}$/u.test(item)
  ));
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

function cancellationState(value: unknown): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>).state === 'string'
    ? String((value as Record<string, unknown>).state)
    : undefined;
}

function validIncident(value: unknown): value is ContainmentIncident {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<ContainmentIncident>;
  return typeof item.id === 'string'
    && typeof item.capabilityId === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.requestedAction === 'string'
    && typeof item.actualObservedResult === 'string'
    && Array.isArray(item.affectedTargets)
    && item.affectedTargets.every(target => typeof target === 'string')
    && Array.isArray(item.evidence)
    && item.evidence.every(entry => typeof entry === 'string')
    && typeof item.active === 'boolean'
    && Boolean(item.recovery && typeof item.recovery.state === 'string' && typeof item.recovery.strategy === 'string');
}

function sanitizeRecovery(value: RollbackContract): RollbackContract {
  return {
    state: value.state,
    strategy: redactSecrets(value.strategy).slice(0, 512),
    ...(value.checkpointId ? { checkpointId: redactSecrets(value.checkpointId).slice(0, 180) } : {}),
    ...(value.backupPathReference ? { backupPathReference: redactSecrets(value.backupPathReference).slice(0, 512) } : {}),
    ...(value.priorStateReference ? { priorStateReference: redactSecrets(value.priorStateReference).slice(0, 512) } : {}),
    ...(value.recoveryInstructions ? { recoveryInstructions: redactSecrets(value.recoveryInstructions).slice(0, 512) } : {}),
  };
}

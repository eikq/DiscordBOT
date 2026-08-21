import { createHash, randomUUID } from 'node:crypto';
import type { CapabilityDescriptor } from '../capabilities/types';
import type {
  ActionEffect,
  ActionEffectKind,
  ActionPreflight,
  CapabilityRollbackSpec,
  CircuitBreakerDecision,
  CircuitBreakerThresholds,
  OperationalRiskLevel,
  RollbackContract,
} from './types';

export const DEFAULT_CIRCUIT_BREAKER_THRESHOLDS: CircuitBreakerThresholds = Object.freeze({
  deleteObjects: 5,
  moveOrRenameObjects: 20,
  modifyObjects: 50,
});

const RISK_ORDER: Record<OperationalRiskLevel, number> = {
  SAFE: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const KIND_RISK: Record<ActionEffectKind, OperationalRiskLevel> = {
  READ: 'SAFE',
  CREATE: 'LOW',
  MODIFY: 'LOW',
  OVERWRITE: 'MEDIUM',
  DELETE: 'MEDIUM',
  MOVE: 'LOW',
  RENAME: 'LOW',
  REMOVE_DIRECTORY: 'HIGH',
  GIT_DESTRUCTIVE: 'CRITICAL',
  SYSTEM_SECURITY_CHANGE: 'CRITICAL',
  DISK_OPERATION: 'CRITICAL',
  CREDENTIAL_CHANGE: 'CRITICAL',
  PERMISSION_CHANGE: 'HIGH',
  PACKAGE_CHANGE: 'HIGH',
  PROCESS_CONTROL: 'MEDIUM',
  SERVICE_CONTROL: 'MEDIUM',
  APPLICATION_LAUNCH: 'LOW',
  NETWORK_ACCESS: 'LOW',
  DATA_CHANGE: 'LOW',
  UNKNOWN_MUTATION: 'HIGH',
};

export class DestructiveActionCircuitBreaker {
  public constructor(
    private readonly thresholds: CircuitBreakerThresholds = DEFAULT_CIRCUIT_BREAKER_THRESHOLDS,
  ) {}

  public resolveEffects(
    descriptor: CapabilityDescriptor,
    input: Record<string, unknown>,
  ): ActionEffect[] {
    const templates = descriptor.effects?.length
      ? descriptor.effects
      : descriptor.sideEffect === 'read'
        ? [{
            kind: 'READ' as const,
            description: 'Read information without changing owner state.',
            destructive: false,
            reversible: true,
            privilege: 'standard_user' as const,
          }]
        : [{
            kind: 'UNKNOWN_MUTATION' as const,
            description: 'Mutate state through a capability without declared effect metadata.',
            destructive: false,
            reversible: false,
            privilege: 'owner_approval' as const,
          }];

    return templates.map(template => {
      const targets = unique([
        ...(template.targets || []),
        ...(template.targetInputFields || []).flatMap(field => inputTargets(input[field])),
      ]);
      const dynamicCount = template.countInputField
        ? safeCount(input[template.countInputField])
        : undefined;
      return {
        kind: template.kind,
        description: template.description,
        destructive: template.destructive,
        reversible: template.reversible,
        privilege: template.privilege,
        ...(template.riskLevel ? { riskLevel: template.riskLevel } : {}),
        targets,
        ...(dynamicCount !== undefined || template.estimatedAffectedObjects !== undefined
          ? { estimatedAffectedObjects: dynamicCount ?? template.estimatedAffectedObjects }
          : {}),
        ...(template.massChangePolicy ? { massChangePolicy: template.massChangePolicy } : {}),
      };
    });
  }

  public assess(effects: ActionEffect[]): CircuitBreakerDecision {
    let risk: OperationalRiskLevel = 'SAFE';
    let reviewRequired = false;
    let blocked = false;
    const reasonCodes: string[] = [];
    const possibleImpact: string[] = [];

    for (const effect of effects) {
      const effectRisk = effect.riskLevel ?? KIND_RISK[effect.kind];
      risk = maxRisk(risk, effectRisk);
      if (effectRisk === 'HIGH' || effectRisk === 'CRITICAL') {
        reviewRequired = true;
        reasonCodes.push(`EFFECT_${effect.kind}`);
      }
      if (effect.destructive) {
        risk = maxRisk(risk, 'HIGH');
        reviewRequired = true;
        reasonCodes.push('DESTRUCTIVE_EFFECT');
        possibleImpact.push(`May irreversibly affect ${describeScope(effect)}.`);
      }
      if (effect.destructive && effect.targets.length === 0) {
        risk = 'CRITICAL';
        reviewRequired = true;
        blocked = true;
        reasonCodes.push('DESTRUCTIVE_SCOPE_UNKNOWN');
        possibleImpact.push('The destructive target scope is not explicit, so execution is blocked.');
      }
      if (effect.massChangePolicy !== 'bounded_generated_output') {
        const count = effect.estimatedAffectedObjects;
        if (effect.kind === 'DELETE' && exceeds(count, this.thresholds.deleteObjects)) {
          risk = maxRisk(risk, 'HIGH');
          reviewRequired = true;
          reasonCodes.push('MASS_DELETE_THRESHOLD');
        }
        if ((effect.kind === 'MOVE' || effect.kind === 'RENAME') && exceeds(count, this.thresholds.moveOrRenameObjects)) {
          risk = maxRisk(risk, 'HIGH');
          reviewRequired = true;
          reasonCodes.push('MASS_MOVE_RENAME_THRESHOLD');
        }
        if ((effect.kind === 'MODIFY' || effect.kind === 'OVERWRITE') && exceeds(count, this.thresholds.modifyObjects)) {
          risk = maxRisk(risk, 'HIGH');
          reviewRequired = true;
          reasonCodes.push('MASS_MODIFY_THRESHOLD');
        }
      }
      if (effect.kind === 'UNKNOWN_MUTATION') {
        reviewRequired = true;
        reasonCodes.push('UNDECLARED_MUTATION_EFFECT');
        possibleImpact.push('The capability has not declared a sufficiently precise mutation contract.');
      }
    }

    if (risk === 'MEDIUM') reviewRequired = true;
    return {
      risk,
      reviewRequired,
      blocked,
      reasonCodes: unique(reasonCodes),
      possibleImpact: unique(possibleImpact),
    };
  }

  public createPreflight(input: {
    descriptor: CapabilityDescriptor;
    capabilityInput: Record<string, unknown>;
    action: string;
    why: string;
    permissionScope?: string[];
  }): ActionPreflight {
    const effects = this.resolveEffects(input.descriptor, input.capabilityInput);
    const decision = this.assess(effects);
    const targets = unique(effects.flatMap(effect => effect.targets));
    const rollback = rollbackFromSpec(input.descriptor.rollback);
    const privilegeRequired = effects.reduce(
      (current, effect) => privilegeRank(effect.privilege) > privilegeRank(current) ? effect.privilege : current,
      'standard_user' as ActionEffect['privilege'],
    );
    const stable = JSON.stringify({ id: input.descriptor.id, targets, effects, at: Date.now() });
    return {
      id: `preflight_${createHash('sha256').update(stable).digest('hex').slice(0, 16)}_${randomUUID().slice(0, 8)}`,
      createdAt: new Date().toISOString(),
      action: input.action,
      why: input.why,
      risk: decision.risk,
      possibleImpact: decision.possibleImpact.length
        ? decision.possibleImpact
        : effects.map(effect => effect.description),
      affectedTargets: targets,
      expectedChanges: effects.map(effect => effect.description),
      protection: protectionsFor(effects, decision),
      reversible: effects.every(effect => effect.reversible),
      rollback,
      privilegeRequired,
      permissionScope: unique(input.permissionScope?.length ? input.permissionScope : targets),
      reviewRequired: decision.reviewRequired,
      blocked: decision.blocked,
      reasonCodes: decision.reasonCodes,
      effects,
    };
  }
}

function rollbackFromSpec(spec: CapabilityRollbackSpec | undefined): RollbackContract {
  if (!spec) {
    return {
      state: 'UNAVAILABLE',
      strategy: 'No recorded rollback contract is available.',
    };
  }
  if (spec.mode === 'not_required') {
    return { state: 'NOT_REQUIRED', strategy: spec.strategy };
  }
  return {
    state: 'UNAVAILABLE',
    strategy: spec.strategy,
    ...(spec.recoveryInstructions ? { recoveryInstructions: spec.recoveryInstructions } : {}),
  };
}

function protectionsFor(effects: ActionEffect[], decision: CircuitBreakerDecision): string[] {
  const values = ['Typed capability validation and policy evaluation occur before execution.'];
  if (decision.reviewRequired) values.push('Explicit owner review is required before execution.');
  if (effects.some(effect => effect.destructive)) values.push('Further related mutation stops if observed effects differ from the proposal.');
  if (effects.every(effect => !effect.destructive)) values.push('The declared effects contain no destructive operation.');
  return values;
}

function inputTargets(value: unknown): string[] {
  if (typeof value === 'string' || typeof value === 'number') return [redactTarget(String(value).slice(0, 512))];
  if (Array.isArray(value)) return value.flatMap(inputTargets).slice(0, 100);
  return [];
}

function redactTarget(value: string): string {
  if (/\b(?:api[_-]?key|authorization|bearer|password|passwd|secret|token|cookie|private[_-]?key)\b\s*[:=]/iu.test(value)) {
    return '[redacted sensitive target]';
  }
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `${url.origin}${url.pathname}`.slice(0, 512);
    }
  } catch {
    // Non-URL target; keep the bounded, non-secret representation.
  }
  return value;
}

function safeCount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.floor(value);
  if (Array.isArray(value)) return value.length;
  return undefined;
}

function exceeds(count: number | undefined, threshold: number): boolean {
  return count !== undefined && count > threshold;
}

function describeScope(effect: ActionEffect): string {
  if (effect.targets.length > 0) return effect.targets.slice(0, 3).join(', ');
  if (effect.estimatedAffectedObjects !== undefined) return `${effect.estimatedAffectedObjects} objects`;
  return 'an unknown target scope';
}

function maxRisk(left: OperationalRiskLevel, right: OperationalRiskLevel): OperationalRiskLevel {
  return RISK_ORDER[right] > RISK_ORDER[left] ? right : left;
}

function privilegeRank(value: ActionEffect['privilege']): number {
  return ['standard_user', 'owner_approval', 'elevated', 'admin', 'unknown'].indexOf(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

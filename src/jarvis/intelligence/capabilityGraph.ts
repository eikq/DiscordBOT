import type {
  CapabilityDependency,
  CapabilityGoalDefinition,
  CapabilityGraphResolution,
  SelfKnowledgeCapability,
  SelfKnowledgeSnapshot,
} from './types';

export class CapabilityGraph {
  private readonly goals = new Map<string, CapabilityGoalDefinition>();

  public register(goal: CapabilityGoalDefinition): void {
    validateGoal(goal);
    if (this.goals.has(goal.id)) throw new Error(`Capability goal ${goal.id} is already registered.`);
    this.goals.set(goal.id, cloneGoal(goal));
  }

  public get(id: string): CapabilityGoalDefinition | undefined {
    const goal = this.goals.get(id);
    return goal ? cloneGoal(goal) : undefined;
  }

  public list(): CapabilityGoalDefinition[] {
    return [...this.goals.values()].map(cloneGoal);
  }

  public resolve(goalId: string, snapshot: SelfKnowledgeSnapshot): CapabilityGraphResolution {
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Unknown capability goal ${goalId}.`);
    return resolveCapabilityGoal(goal, snapshot);
  }
}

export function resolveCapabilityGoal(
  goal: CapabilityGoalDefinition,
  snapshot: SelfKnowledgeSnapshot,
): CapabilityGraphResolution {
  validateGoal(goal);
  const byId = new Map(snapshot.capabilities.map(item => [item.id, item]));
  const selected: string[] = [];
  const missing: CapabilityGraphResolution['missing'] = [];
  const optionalUnavailable: string[] = [];

  for (const dependency of goal.dependencies.filter(item => item.relation === 'REQUIRED')) {
    const capability = byId.get(dependency.capabilityId);
    if (isUsable(capability, Boolean(goal.allowSimulation))) selected.push(dependency.capabilityId);
    else missing.push(missingDependency(dependency, capability));
  }

  const alternatives = groupAlternatives(goal.dependencies);
  for (const [group, dependencies] of alternatives) {
    const usable = dependencies.find(item => isUsable(byId.get(item.capabilityId), Boolean(goal.allowSimulation)));
    if (usable) selected.push(usable.capabilityId);
    else {
      for (const dependency of dependencies) {
        missing.push(missingDependency({ ...dependency, alternativeGroup: group }, byId.get(dependency.capabilityId)));
      }
    }
  }

  for (const dependency of goal.dependencies.filter(item => item.relation === 'OPTIONAL')) {
    if (isUsable(byId.get(dependency.capabilityId), Boolean(goal.allowSimulation))) selected.push(dependency.capabilityId);
    else optionalUnavailable.push(dependency.capabilityId);
  }

  return {
    goal: cloneGoal(goal),
    selected: [...new Set(selected)],
    missing,
    optionalUnavailable,
    ready: missing.length === 0,
    evidence: [
      `self-knowledge:${snapshot.generatedAt}`,
      ...selected.map(id => `capability:${id}`),
    ],
  };
}

function groupAlternatives(dependencies: CapabilityDependency[]): Map<string, CapabilityDependency[]> {
  const groups = new Map<string, CapabilityDependency[]>();
  for (const item of dependencies.filter(entry => entry.relation === 'ALTERNATIVE')) {
    const group = item.alternativeGroup || item.capabilityId;
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return groups;
}

function isUsable(capability: SelfKnowledgeCapability | undefined, allowSimulation: boolean): boolean {
  if (!capability?.registered) return false;
  if (capability.status === 'AVAILABLE' || capability.status === 'DEGRADED') return true;
  return allowSimulation && capability.status === 'SIMULATION';
}

function missingDependency(
  dependency: CapabilityDependency,
  capability?: SelfKnowledgeCapability,
): CapabilityGraphResolution['missing'][number] {
  return {
    capabilityId: dependency.capabilityId,
    relation: dependency.relation,
    status: capability?.status ?? 'UNSUPPORTED',
    reason: capability?.reason ?? `Capability ${dependency.capabilityId} is not registered or declared.`,
  };
}

function validateGoal(goal: CapabilityGoalDefinition): void {
  if (!goal.id.trim() || !goal.title.trim()) throw new Error('Capability goal requires an id and title.');
  if (goal.dependencies.length === 0) throw new Error('Capability goal requires at least one dependency.');
  const duplicates = goal.dependencies.map(item => item.capabilityId)
    .filter((id, index, all) => all.indexOf(id) !== index);
  if (duplicates.length) throw new Error(`Capability goal contains duplicate dependencies: ${duplicates.join(', ')}.`);
  for (const dependency of goal.dependencies) {
    if (!dependency.capabilityId.trim()) throw new Error('Capability dependency id is required.');
    if (dependency.relation === 'ALTERNATIVE' && !dependency.alternativeGroup?.trim()) {
      throw new Error(`Alternative ${dependency.capabilityId} requires an alternativeGroup.`);
    }
  }
}

function cloneGoal(goal: CapabilityGoalDefinition): CapabilityGoalDefinition {
  return { ...goal, dependencies: goal.dependencies.map(item => ({ ...item })) };
}

import type { PlanStep } from './types';

export function assertAcyclic(steps: PlanStep[]): void {
  const byId = new Map(steps.map(step => [step.id, step]));
  for (const step of steps) {
    if (!byId.has(step.id)) throw Object.assign(new Error('Unknown plan step.'), { reasonCode: 'PLAN_INVALID' });
    for (const dep of step.dependencies) {
      if (!byId.has(dep)) {
        throw Object.assign(new Error(`Step ${step.id} depends on missing ${dep}.`), { reasonCode: 'PLAN_INVALID' });
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw Object.assign(new Error(`Plan has a dependency cycle: ${[...stack, id].join(' → ')}.`), {
        reasonCode: 'DEPENDENCY_CYCLE',
      });
    }
    visiting.add(id);
    for (const dep of byId.get(id)?.dependencies ?? []) visit(dep, [...stack, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of steps) visit(step.id, []);
}

export function readySteps(steps: PlanStep[]): PlanStep[] {
  const byId = new Map(steps.map(step => [step.id, step]));
  return steps.filter(step => {
    if (step.status !== 'pending' && step.status !== 'ready' && step.status !== 'retrying') return false;
    return step.dependencies.every(dep => byId.get(dep)?.status === 'done');
  });
}

export function blockedByFailedDep(steps: PlanStep[]): PlanStep[] {
  const byId = new Map(steps.map(step => [step.id, step]));
  return steps.filter(step => {
    if (step.status === 'done' || step.status === 'failed' || step.status === 'cancelled') return false;
    return step.dependencies.some(dep => byId.get(dep)?.status === 'failed');
  });
}

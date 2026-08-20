import type { ResourcePriority } from './types';

/**
 * Highest number wins. Background work yields when a strictly higher
 * priority appears. Scheduler/resource signal only — not OS niceness.
 */
export const RESOURCE_PRIORITY_ORDER = [
  'realtime_voice',
  'owner_task',
  'scheduled_action',
  'monitoring',
  'background_evolution',
] as const satisfies readonly ResourcePriority[];

export const RESOURCE_PRIORITY_RANK: Record<ResourcePriority, number> = {
  realtime_voice: 5,
  owner_task: 4,
  scheduled_action: 3,
  monitoring: 2,
  background_evolution: 1,
};

export function resourcePriorityRank(priority: ResourcePriority): number {
  return RESOURCE_PRIORITY_RANK[priority];
}

export function yieldsTo(self: ResourcePriority, pressure: ResourcePriority): boolean {
  return RESOURCE_PRIORITY_RANK[pressure] > RESOURCE_PRIORITY_RANK[self];
}

export function shouldYieldBackground(
  pressure: ResourcePriority,
  self: ResourcePriority = 'background_evolution',
): boolean {
  return yieldsTo(self, pressure);
}

export function higherResourcePriority(a: ResourcePriority, b: ResourcePriority): ResourcePriority {
  return RESOURCE_PRIORITY_RANK[a] >= RESOURCE_PRIORITY_RANK[b] ? a : b;
}

export function evaluatePreemption(running: ResourcePriority, incoming: ResourcePriority): {
  running: ResourcePriority;
  incoming: ResourcePriority;
  yieldRunning: boolean;
} {
  return {
    running,
    incoming,
    yieldRunning: yieldsTo(running, incoming),
  };
}

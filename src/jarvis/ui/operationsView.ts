import type { JarvisOperationEvent } from '../security/types';
import type { JarvisVisualState } from '../ops/types';
import { operationalLabel } from '../ops/visualState';
import type { WorkTask } from '../agent/types';
import type { CapabilityAssessment } from '../evolution/selfModel';

export type LiveOpsStep = {
  id: string;
  index: string;
  title: string;
  state: 'done' | 'active' | 'pending' | 'failed' | 'blocked' | 'cancelled' | 'waiting';
  capability?: string;
  summary?: string;
};

export function liveOpsSteps(task: WorkTask | null): LiveOpsStep[] {
  if (!task) return [];
  return task.plan.map((step, index) => ({
    id: step.id,
    index: String(index + 1).padStart(2, '0'),
    title: step.title,
    state: step.status === 'done' || step.status === 'skipped'
      ? 'done'
      : step.status === 'running' || step.status === 'retrying'
        ? 'active'
        : step.status === 'failed'
          ? 'failed'
          : step.status === 'waiting_permission'
            ? 'waiting'
            : step.status === 'blocked' || step.status === 'cancelled'
              ? 'blocked'
              : 'pending',
    ...(step.capability ? { capability: step.capability } : {}),
    ...(step.resultSummary ? { summary: step.resultSummary } : {}),
  }));
}

export function windowedEvents(events: JarvisOperationEvent[], limit = 80): JarvisOperationEvent[] {
  return events.slice(-Math.max(1, Math.min(limit, 200)));
}

export function uniqueEventsBySeq<T extends { seq: number }>(events: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const event of events) {
    if (seen.has(event.seq)) continue;
    seen.add(event.seq);
    out.push(event);
  }
  return out;
}

export function acceptSseSeq(lastSeq: number, incoming: number): number | null {
  if (!Number.isFinite(incoming) || incoming <= lastSeq) return null;
  return incoming;
}

export function capabilityBar(assessment: CapabilityAssessment): { label: string; text: string; pct: number | null } {
  if (assessment.confidence === null || assessment.recentTrend === 'insufficient_data') {
    return { label: assessment.capability, text: 'INSUFFICIENT DATA', pct: null };
  }
  return {
    label: assessment.capability,
    text: assessment.recentTrend,
    pct: Math.round(assessment.confidence * 100),
  };
}

export function sourceGraphLayout(domains: string[]): Array<{ domain: string; x: number; y: number }> {
  const unique = [...new Set(domains.filter(Boolean))].slice(0, 12);
  if (unique.length === 0) return [];
  return unique.map((domain, index) => {
    const angle = (Math.PI * 2 * index) / unique.length - Math.PI / 2;
    return {
      domain,
      x: 50 + Math.cos(angle) * 38,
      y: 50 + Math.sin(angle) * 38,
    };
  });
}

export function visualStatusLine(state: JarvisVisualState, progress?: { current: number; total: number }): string {
  return operationalLabel(state, progress);
}

export type SystemNodeState = 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'BLOCKED';

export function systemNodeState(input: { attached?: boolean; healthy?: boolean; reachable?: boolean; blocked?: boolean }): SystemNodeState {
  if (input.blocked) return 'BLOCKED';
  if (input.attached === false || input.reachable === false) return 'UNAVAILABLE';
  if (input.healthy === false) return 'DEGRADED';
  if (input.attached || input.reachable || input.healthy) return 'AVAILABLE';
  return 'UNAVAILABLE';
}

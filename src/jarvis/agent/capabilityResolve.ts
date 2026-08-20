import { DESKTOP_OPEN_TRUSTED_URL, SYSTEM_STATUS } from '../capabilities/actions/constants';
import type { CapabilityHost } from '../capabilities/types';
import { inferDesktopPresenceIntent } from '../desktop/intent';
import { RESEARCH_SEARCH } from '../research/constants';
import { WORKSPACE_SEARCH } from '../workspace/constants';
import type { PlanStep, PlanStepKind, WorkTask } from './types';

export { capabilityKind, defaultPlanFor, needsOwnerPermission, planForObjective } from './plans';

const BLOCKED_CAPABILITY = /(?:^|[._:/\s-])(shell|exec|spawn|cmd|powershell|pwsh|bash|zsh|\/bin\/sh|osascript)(?:$|[._:/\s-])/iu;

export function isBlockedCapabilityId(id: string): boolean {
  if (!id || id.includes('..') || id.includes('\\') || id.startsWith('/')) return true;
  return BLOCKED_CAPABILITY.test(id);
}

type CapabilityLookup = Pick<CapabilityHost, 'lookup'>;

export function inferCapabilityFromObjective(objective: string, host?: CapabilityLookup): string | undefined {
  const text = objective.trim();
  if (!text) return undefined;
  const has = (id: string) => Boolean(host?.lookup(id));
  if ((/system status|สถานะระบบ|runtime status/iu.test(text) || /^status$/iu.test(text)) && has(SYSTEM_STATUS)) {
    return SYSTEM_STATUS;
  }
  const url = firstHttpsUrl(text);
  if (url && has(DESKTOP_OPEN_TRUSTED_URL)) {
    return DESKTOP_OPEN_TRUSTED_URL;
  }
  if ((/research|ค้นเว็บ|search the web|official source/iu.test(text)) && has(RESEARCH_SEARCH)) {
    return RESEARCH_SEARCH;
  }
  if ((/workspace|หาไฟล์|find symbol|local file|search (the )?repo|inspect these files|fix the issue/iu.test(text)) && has(WORKSPACE_SEARCH)) {
    return WORKSPACE_SEARCH;
  }
  const desktop = inferDesktopPresenceIntent(text);
  if (desktop.kind === 'action' && has(desktop.capabilityId)) {
    return desktop.capabilityId;
  }
  return undefined;
}

export function resolveStepCapability(
  task: WorkTask,
  step: PlanStep,
  host?: CapabilityLookup,
): { id: string; input: Record<string, unknown> } | undefined {
  const fromStep = typeof step.capability === 'string' ? step.capability.trim() : '';
  const fromInput = typeof step.input?.capability === 'string' ? String(step.input.capability).trim() : '';
  const inferred = fromStep || fromInput || inferFromKind(step.kind, host);
  if (!inferred) return undefined;
  return { id: inferred, input: defaultInputFor(inferred, task, step) };
}

function inferFromKind(kind: PlanStepKind, host?: CapabilityLookup): string | undefined {
  if (kind === 'research' && host?.lookup(RESEARCH_SEARCH)) return RESEARCH_SEARCH;
  if ((kind === 'search' || kind === 'retrieve') && host?.lookup(WORKSPACE_SEARCH)) return WORKSPACE_SEARCH;
  return undefined;
}

function defaultInputFor(id: string, task: WorkTask, step: PlanStep): Record<string, unknown> {
  const extra = step.input ? { ...step.input } : {};
  delete extra.capability;
  if (id === RESEARCH_SEARCH || id === WORKSPACE_SEARCH) {
    return { query: String(extra.query || task.objective).slice(0, 200), ...extra };
  }
  if (id === DESKTOP_OPEN_TRUSTED_URL) {
    const url = String(extra.url || firstHttpsUrl(task.objective) || '').slice(0, 500);
    return url ? { ...extra, url } : extra;
  }
  if (id.startsWith('desktop.')) {
    const intent = inferDesktopPresenceIntent(task.objective);
    if (intent.kind === 'action') return { ...intent.arguments, ...extra };
  }
  return extra;
}

function firstHttpsUrl(text: string): string | undefined {
  const match = text.match(/https:\/\/[^\s]+/iu);
  return match?.[0]?.replace(/[)\].,;]+$/u, '');
}

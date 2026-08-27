import { SYSTEM_STATUS } from '../capabilities/actions/constants';
import type { CapabilityHost } from '../capabilities/types';
import { RESEARCH_SEARCH } from '../research/constants';
import { WORKSPACE_SEARCH } from '../workspace/constants';
import type { PlanStep, PlanStepKind, WorkTask } from './types';

export { capabilityKind, defaultPlanFor, needsOwnerPermission, planForGoalResolution, planForObjective } from './plans';

const BLOCKED_CAPABILITY = /(?:^|[._:/\s-])(shell|exec|spawn|cmd|powershell|pwsh|bash|zsh|\/bin\/sh|osascript)(?:$|[._:/\s-])/iu;

export function isBlockedCapabilityId(id: string): boolean {
  if (!id || id.includes('..') || id.includes('\\') || id.startsWith('/')) return true;
  return BLOCKED_CAPABILITY.test(id);
}

export function inferCapabilityFromObjective(objective: string, host?: CapabilityHost): string | undefined {
  const text = objective.trim();
  if (!text) return undefined;
  const has = (id: string) => Boolean(host?.lookup(id));
  if ((/system status|สถานะระบบ|runtime status/iu.test(text) || /^status$/iu.test(text)) && has(SYSTEM_STATUS)) {
    return SYSTEM_STATUS;
  }
  if ((/สร้างเว็บ|ทำเว็บ|build (?:a |an )?(?:web|site|portfolio)|สร้างแอป|build (?:a |an )?(?:app|todo|dashboard)/iu.test(text)) && (has('software.planBuild'))) {
    return 'software.planBuild';
  }
  if ((/เขียนโค้ด|write code|สร้างไฟล์|create (?:project )?files|รัน\s*(?:unit\s*)?tests?|run (?:the |unit )?tests?/iu.test(text)) && has('software.applyBuild')) {
    return 'software.applyBuild';
  }
  if ((/research|ค้นเว็บ|search the web|official source|documentation|docs|ค้นเอกสาร|หาข้อมูล/iu.test(text)) && has(RESEARCH_SEARCH)) {
    return RESEARCH_SEARCH;
  }
  if ((/workspace|หาไฟล์|find symbol|local file|search (the )?repo|inspect these files|fix the issue/iu.test(text)) && has(WORKSPACE_SEARCH)) {
    return WORKSPACE_SEARCH;
  }
  return undefined;
}

export function resolveStepCapability(
  task: WorkTask,
  step: PlanStep,
  host?: CapabilityHost,
): { id: string; input: Record<string, unknown> } | undefined {
  const fromStep = typeof step.capability === 'string' ? step.capability.trim() : '';
  const fromInput = typeof step.input?.capability === 'string' ? String(step.input.capability).trim() : '';
  const inferred = fromStep || fromInput || inferFromKind(step.kind, host);
  if (!inferred) return undefined;
  return { id: inferred, input: defaultInputFor(inferred, task, step) };
}

function inferFromKind(kind: PlanStepKind, host?: CapabilityHost): string | undefined {
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
  if (id === 'software.planBuild' || id === 'software.applyBuild') {
    const brief = String(extra.brief || extra.query || task.objective).slice(0, 8_000);
    return { brief, query: brief, ...extra };
  }
  return extra;
}

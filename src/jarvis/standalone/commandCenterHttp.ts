import {
  AUTONOMY_LEVELS,
  type AutonomyLevel,
  type OwnerControl,
  type OwnerControlState,
} from '../control';

export type DemoScenarioId = 'research' | 'coding' | 'evolution' | 'monitoring';

export const DEMO_SCENARIOS: DemoScenarioId[] = ['research', 'coding', 'evolution', 'monitoring'];

const RESEARCH_DEPTHS: OwnerControlState['researchDepth'][] = ['none', 'quick', 'standard', 'deep', 'forensic'];

export type ControlPatchInput = {
  maxAutonomy?: AutonomyLevel;
  currentAutonomy?: AutonomyLevel;
  researchDepth?: OwnerControlState['researchDepth'];
  backgroundEvolution?: boolean;
  nightCycle?: boolean;
  proactiveAlerts?: boolean;
  simulationMode?: boolean;
};

export function parseDemoScenario(value: unknown): DemoScenarioId | undefined {
  return typeof value === 'string' && (DEMO_SCENARIOS as string[]).includes(value)
    ? value as DemoScenarioId
    : undefined;
}

export function parseObjective(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const objective = value.trim();
  if (objective.length < 2 || objective.length > 240) return undefined;
  if (/\.\./u.test(objective) || /\\/u.test(objective)) return undefined;
  if (/\//u.test(objective) && !/\bhttps?:\/\//iu.test(objective)) return undefined;
  return objective;
}

export function parseNightAction(value: unknown): 'run' | 'pause' | 'cancel' | 'resume' | undefined {
  return value === 'run' || value === 'pause' || value === 'cancel' || value === 'resume' ? value : undefined;
}

export function parseTaskId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return /^task_[a-f0-9]{8,24}$/iu.test(id) ? id : undefined;
}

export function parseStepId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = value.trim();
  return /^[a-z][a-z0-9_]{2,40}$/iu.test(id) ? id : undefined;
}

export function parsePermissionGrant(body: unknown): {
  taskId?: string;
  stepId?: string;
  proposalId?: string;
  token?: string;
  capability?: string;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const raw = body as Record<string, unknown>;
  return {
    taskId: parseTaskId(raw.taskId),
    stepId: parseStepId(raw.stepId),
    proposalId: typeof raw.proposalId === 'string' ? raw.proposalId.trim() : undefined,
    token: typeof raw.token === 'string' ? raw.token : undefined,
    capability: typeof raw.capability === 'string' ? raw.capability.trim() : undefined,
  };
}

function asAutonomy(value: unknown): AutonomyLevel | undefined {
  return typeof value === 'number' && (AUTONOMY_LEVELS as readonly number[]).includes(value)
    ? value as AutonomyLevel
    : undefined;
}

export function parseControlPatch(body: unknown): { ok: true; patch: ControlPatchInput } | { ok: false; error: string } {
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Control payload must be an object.' };
  }
  const raw = body as Record<string, unknown>;
  const patch: ControlPatchInput = {};
  if ('maxAutonomy' in raw) {
    const value = asAutonomy(raw.maxAutonomy);
    if (value === undefined) return { ok: false, error: 'maxAutonomy must be an integer 0–5.' };
    patch.maxAutonomy = value;
  }
  if ('currentAutonomy' in raw) {
    const value = asAutonomy(raw.currentAutonomy);
    if (value === undefined) return { ok: false, error: 'currentAutonomy must be an integer 0–5.' };
    patch.currentAutonomy = value;
  }
  if ('researchDepth' in raw) {
    if (typeof raw.researchDepth !== 'string' || !(RESEARCH_DEPTHS as string[]).includes(raw.researchDepth)) {
      return { ok: false, error: 'researchDepth is not a supported depth.' };
    }
    patch.researchDepth = raw.researchDepth as OwnerControlState['researchDepth'];
  }
  for (const key of ['backgroundEvolution', 'nightCycle', 'proactiveAlerts', 'simulationMode'] as const) {
    if (key in raw) {
      if (typeof raw[key] !== 'boolean') return { ok: false, error: `${key} must be a boolean.` };
      patch[key] = raw[key];
    }
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: 'No control fields provided.' };
  return { ok: true, patch };
}

export function applyOwnerControl(control: OwnerControl, patch: ControlPatchInput): OwnerControlState {
  if (patch.maxAutonomy !== undefined) control.setMaxAutonomy(patch.maxAutonomy, 'owner');
  if (patch.currentAutonomy !== undefined) control.setCurrentAutonomy(patch.currentAutonomy, 'owner');
  return control.patch({
    ...(patch.researchDepth !== undefined ? { researchDepth: patch.researchDepth } : {}),
    ...(patch.backgroundEvolution !== undefined ? { backgroundEvolution: patch.backgroundEvolution } : {}),
    ...(patch.nightCycle !== undefined ? { nightCycle: patch.nightCycle } : {}),
    ...(patch.proactiveAlerts !== undefined ? { proactiveAlerts: patch.proactiveAlerts } : {}),
    ...(patch.simulationMode !== undefined ? { simulationMode: patch.simulationMode } : {}),
  }, 'owner');
}

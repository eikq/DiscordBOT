import { AUTONOMY_LABELS } from '../control';
import { liveOpsSteps, capabilityBar, systemNodeState, visualStatusLine, windowedEvents, type LiveOpsStep } from '../ui/operationsView';
import type { CommandCenterSnapshot } from './commandCenter';
// Snapshot type only — keep this module import-safe for the Express lab server.

const ACTIVE_TASK = new Set([
  'RECEIVED',
  'UNDERSTANDING',
  'PLANNING',
  'READY',
  'EXECUTING',
  'OBSERVING',
  'ADAPTING',
  'VERIFYING',
  'WAITING_PERMISSION',
  'PAUSED',
  'DEGRADED',
]);

export type CommandCenterClientSnapshot = {
  simulationMode: boolean;
  visualState: string;
  visualLabel: string;
  fresh: boolean;
  operations: Array<{
    id: string;
    seq: number;
    type: string;
    at: string;
    level: string;
    summary: string;
    simulated?: boolean;
    visualState?: string;
    taskId?: string;
    progress?: { current: number; total: number; unit?: string };
    errorCode?: string;
  }>;
  task: {
    id: string;
    objective: string;
    status: string;
    outcome?: string;
    simulated?: boolean;
    waitingPermission: boolean;
    active: boolean;
    steps: LiveOpsStep[];
    evidence: string[];
    errors: string[];
    verification?: NonNullable<CommandCenterSnapshot['task']>['verification'];
    rollback?: NonNullable<CommandCenterSnapshot['task']>['rollback'];
    preflight?: NonNullable<CommandCenterSnapshot['task']>['plan'][number]['preflight'];
    cancellation?: NonNullable<CommandCenterSnapshot['task']>['cancellation'];
    gapResolution?: NonNullable<CommandCenterSnapshot['task']>['gapResolution'];
    blockers?: NonNullable<CommandCenterSnapshot['task']>['blockers'];
    goalResolution?: NonNullable<CommandCenterSnapshot['task']>['goalResolution'];
    goalOutcome?: NonNullable<CommandCenterSnapshot['task']>['goalOutcome'];
    adapters: Array<{ stepId: string; capability: string; adapterId: string; evidence: string[] }>;
  } | null;
  recentTasks: Array<{ id: string; objective: string; status: string; simulated?: boolean }>;
  evolution: {
    experiences: number;
    reflections: number;
    skills: number;
    failures: number;
    goals: string[];
    lessons: string[];
    affect: { valence: number; confidence: number };
    selfModel: Array<{ label: string; text: string; pct: number | null }>;
    night: {
      status: string;
      stage: string | null;
      pausedFor?: string;
      experiencesProcessed: number;
      reflectionsCreated: number;
      skillsProposed: number;
    };
    candidates: Array<{ id: string; hypothesis: string; status: string; simulated?: boolean }>;
    productionPromotionAllowed: false;
    benchmarks: Array<{ id: string; category: string; passed: boolean; detail: string }>;
    graph: { nodes: number; edges: number; empty: boolean };
    modelAdaptation: { trained: false; candidates: number };
  };
  request: { route: string; socialAction: string; agentic: boolean; reason: string } | null;
  permission: {
    waiting: boolean;
    taskId?: string;
    stepId?: string;
    capability?: string;
    proposalId?: string;
    preflight?: CommandCenterSnapshot['permission']['preflight'];
  };
  memoryActivity: { experiences: number; reflections: number; skills: number };
  devices: Array<{
    id: string;
    label: string;
    kind: string;
    status: string;
    node: ReturnType<typeof systemNodeState>;
    simulated: boolean;
    distribution: Array<'OWNER_ONLY' | 'COMMUNITY_EXCLUDED' | 'DEMO_EXCLUDED'>;
  }>;
  notifications: Array<{ id: string; summary: string; severity: string; simulated: boolean }>;
  control: CommandCenterSnapshot['control'] & { autonomyLabel: string; maxAutonomyLabel: string };
  vision: { title: string; simulated: boolean; elements: number } | null;
};

export function presentCommandCenter(
  snapshot: CommandCenterSnapshot,
  now: () => number = Date.now,
): CommandCenterClientSnapshot {
  const operations = windowedEvents(snapshot.operations, 40).map(event => ({
    id: event.id,
    seq: event.seq,
    type: event.type,
    at: event.at,
    level: event.level,
    summary: event.summary,
    ...(event.simulated ? { simulated: true } : {}),
    ...(event.visualState ? { visualState: event.visualState } : {}),
    ...(event.taskId ? { taskId: event.taskId } : {}),
    ...(event.progress ? { progress: event.progress } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  }));
  const lastAt = operations.at(-1)?.at;
  const fresh = Boolean(lastAt && now() - Date.parse(lastAt) < 15_000);
  const task = snapshot.task;
  return {
    simulationMode: snapshot.simulationMode,
    visualState: snapshot.visualState,
    visualLabel: visualStatusLine(snapshot.visualState, snapshot.operations.at(-1)?.progress),
    fresh,
    operations,
    task: task
      ? {
          id: task.id,
          objective: task.objective,
          status: task.status,
          simulated: task.simulated,
          waitingPermission: task.status === 'WAITING_PERMISSION' || task.plan.some(step => step.status === 'waiting_permission'),
          active: ACTIVE_TASK.has(task.status),
          steps: liveOpsSteps(task),
          evidence: task.evidence.slice(0, 6),
          errors: task.errors.map(item => item.message).slice(0, 4),
          ...(task.verification ? { verification: task.verification } : {}),
          ...(task.rollback ? { rollback: task.rollback } : {}),
          ...(task.cancellation ? { cancellation: task.cancellation } : {}),
          ...(task.gapResolution ? { gapResolution: task.gapResolution } : {}),
          ...(task.blockers ? { blockers: task.blockers } : {}),
          ...(task.goalResolution ? { goalResolution: task.goalResolution } : {}),
          ...(task.goalOutcome ? { goalOutcome: task.goalOutcome } : {}),
          adapters: task.plan.flatMap(step => step.inputAdapter ? [{
            stepId: step.id,
            capability: step.capability || 'unknown',
            adapterId: step.inputAdapter.id,
            evidence: [...step.inputAdapter.evidence],
          }] : []),
          ...([...task.plan].reverse().find(step => step.preflight)?.preflight
            ? { preflight: [...task.plan].reverse().find(step => step.preflight)!.preflight }
            : {}),
          ...(task.outcome ? { outcome: task.outcome } : {}),
        }
      : null,
    recentTasks: snapshot.tasks.slice(-5).reverse().map(item => ({
      id: item.id,
      objective: item.objective,
      status: item.status,
      simulated: item.simulated,
    })),
    evolution: {
      experiences: snapshot.evolution.experiences,
      reflections: snapshot.evolution.reflections,
      skills: snapshot.evolution.skills,
      failures: snapshot.evolution.failures,
      goals: snapshot.evolution.goals.slice(0, 3),
      lessons: snapshot.evolution.journal.newLessons.slice(0, 4),
      affect: {
        valence: snapshot.evolution.affect.valence,
        confidence: snapshot.evolution.affect.confidence,
      },
      selfModel: snapshot.evolution.selfModel.slice(0, 6).map(capabilityBar),
      night: {
        status: snapshot.evolution.night.status,
        stage: snapshot.evolution.night.stage,
        pausedFor: snapshot.evolution.night.pausedFor,
        experiencesProcessed: snapshot.evolution.night.experiencesProcessed,
        reflectionsCreated: snapshot.evolution.night.reflectionsCreated,
        skillsProposed: snapshot.evolution.night.skillsProposed,
      },
      candidates: snapshot.evolution.candidates.slice(0, 6).map(item => ({
        id: item.id,
        hypothesis: item.hypothesis,
        status: item.status,
        simulated: item.simulated,
      })),
      productionPromotionAllowed: false,
      benchmarks: snapshot.evolution.benchmarks.slice(0, 8).map(item => ({
        id: item.id,
        category: item.category,
        passed: item.passed,
        detail: item.detail,
      })),
      graph: {
        nodes: snapshot.evolution.graph.nodes.length,
        edges: snapshot.evolution.graph.edges.length,
        empty: snapshot.evolution.graph.nodes.length === 0,
      },
      modelAdaptation: {
        trained: false,
        candidates: snapshot.evolution.modelAdaptation.candidates,
      },
    },
    request: snapshot.request
      ? {
          route: snapshot.request.route.route,
          socialAction: snapshot.request.route.socialAction,
          agentic: snapshot.request.route.agentic,
          reason: snapshot.request.route.reason,
        }
      : null,
    permission: {
      waiting: snapshot.permission.waiting,
      taskId: snapshot.permission.taskId,
      stepId: snapshot.permission.stepId,
      capability: snapshot.permission.capability,
      proposalId: snapshot.permission.proposalId,
      preflight: snapshot.permission.preflight,
    },
    memoryActivity: snapshot.memoryActivity,
    devices: snapshot.devices.map(device => ({
      id: device.id,
      label: device.label,
      kind: device.kind,
      status: device.status,
      node: systemNodeState({
        attached: device.status !== 'offline',
        healthy: device.status === 'online',
        reachable: device.status !== 'offline',
        blocked: false,
      }),
      simulated: device.simulated,
      distribution: [...device.distribution],
    })),
    notifications: snapshot.notifications.slice(0, 8).map(item => ({
      id: item.id,
      summary: item.summary,
      severity: item.severity,
      simulated: Boolean(item.simulated),
    })),
    control: {
      ...snapshot.control,
      autonomyLabel: AUTONOMY_LABELS[snapshot.control.currentAutonomy],
      maxAutonomyLabel: AUTONOMY_LABELS[snapshot.control.maxAutonomy],
    },
    vision: snapshot.vision
      ? {
          title: snapshot.vision.windowTitle,
          simulated: snapshot.vision.simulated,
          elements: snapshot.vision.elements.length,
        }
      : null,
  };
}

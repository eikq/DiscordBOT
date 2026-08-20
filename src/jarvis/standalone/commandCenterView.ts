import { AUTONOMY_LABELS } from '../control';
import { liveOpsSteps, capabilityBar, systemNodeState, visualStatusLine, uniqueEventsBySeq, windowedEvents, type LiveOpsStep } from '../ui/operationsView';
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
    verification?: string;
    simulated?: boolean;
    waitingPermission: boolean;
    active: boolean;
    steps: LiveOpsStep[];
    evidence: string[];
    errors: string[];
  } | null;
  lastTask: {
    id: string;
    objective: string;
    status: string;
    outcome?: string;
    verification?: string;
    simulated?: boolean;
    waitingPermission: boolean;
    active: boolean;
    steps: LiveOpsStep[];
    evidence: string[];
    errors: string[];
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
  request: { route: string; socialAction: string; agentic: boolean; reason: string; requestId?: string } | null;
  permission: {
    waiting: boolean;
    taskId?: string;
    stepId?: string;
    capability?: string;
    proposalId?: string;
    risk?: string;
    scope?: Record<string, unknown>;
  };
  memoryActivity: { experiences: number; reflections: number; skills: number };
  devices: Array<{
    id: string;
    label: string;
    kind: string;
    status: string;
    node: ReturnType<typeof systemNodeState>;
    simulated: boolean;
  }>;
  notifications: Array<{ id: string; summary: string; severity: string; simulated: boolean }>;
  control: CommandCenterSnapshot['control'] & { autonomyLabel: string; maxAutonomyLabel: string };
  vision: { title: string; simulated: boolean; elements: number } | null;
  intelligence: {
    traces: { count: number; lastRoute?: string; lastInput?: string };
    analyzer: { status: string; reason?: string; samples: number };
    runtimeSpec: { id: string; version: number };
    specCandidates: Array<{ id: string; hypothesis: string; status: string }>;
    models: Array<{ id: string; trustTier: string }>;
    certifications: Array<{ modelProfileId: string; status: string; passed: number; total: number }>;
    efficiency: { status: string; p50Ms?: number; p95Ms?: number; tokensPerSec?: number; reason?: string };
    artifacts: Array<{ taskId: string; status: string; artifactClass: string; simulated: boolean }>;
    scheduler: { competingSchedulerAdded: false; jobIsPermanentPermission: false };
    productionPromotionAllowed: false;
  };
};

export function presentCommandCenter(
  snapshot: CommandCenterSnapshot,
  now: () => number = Date.now,
): CommandCenterClientSnapshot {
  const operations = uniqueEventsBySeq(windowedEvents(snapshot.operations, 40)).map(event => ({
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
  return {
    simulationMode: snapshot.simulationMode,
    visualState: snapshot.visualState,
    visualLabel: visualStatusLine(snapshot.visualState, snapshot.operations.at(-1)?.progress),
    fresh,
    operations,
    task: presentInspectableTask(snapshot.task),
    lastTask: presentInspectableTask(snapshot.lastTask),
    recentTasks: [...snapshot.tasks]
      .sort((a, b) => (Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0))
      .slice(-5)
      .reverse()
      .map(item => ({
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
          ...(snapshot.request.requestId ? { requestId: snapshot.request.requestId } : {}),
        }
      : null,
    permission: {
      waiting: snapshot.permission.waiting,
      taskId: snapshot.permission.taskId,
      stepId: snapshot.permission.stepId,
      capability: snapshot.permission.capability,
      proposalId: snapshot.permission.proposalId,
      ...(snapshot.permission.risk ? { risk: snapshot.permission.risk } : {}),
      ...(snapshot.permission.scope ? { scope: snapshot.permission.scope } : {}),
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
    intelligence: {
      traces: {
        count: snapshot.intelligence.traces.count,
        lastRoute: snapshot.intelligence.traces.recent.at(-1)?.route,
        lastInput: snapshot.intelligence.traces.recent.at(-1)?.inputText,
      },
      analyzer: {
        status: snapshot.intelligence.analyzer.status,
        reason: snapshot.intelligence.analyzer.reason,
        samples: snapshot.intelligence.analyzer.sampleCount,
      },
      runtimeSpec: snapshot.intelligence.runtimeSpec,
      specCandidates: snapshot.intelligence.specCandidates.map(item => ({
        id: item.id,
        hypothesis: item.hypothesis,
        status: item.status,
      })),
      models: snapshot.intelligence.models.map(item => ({
        id: item.id,
        trustTier: item.trustTier,
      })),
      certifications: snapshot.intelligence.certifications.map(item => ({
        modelProfileId: item.modelProfileId,
        status: item.status,
        passed: item.passed,
        total: item.total,
      })),
      efficiency: {
        status: snapshot.intelligence.efficiency.status,
        p50Ms: snapshot.intelligence.efficiency.p50Ms,
        p95Ms: snapshot.intelligence.efficiency.p95Ms,
        tokensPerSec: snapshot.intelligence.efficiency.tokensPerSec,
        reason: snapshot.intelligence.efficiency.reason,
      },
      artifacts: snapshot.intelligence.artifacts,
      scheduler: {
        competingSchedulerAdded: false,
        jobIsPermanentPermission: false,
      },
      productionPromotionAllowed: false,
    },
  };
}

function presentInspectableTask(
  task: CommandCenterSnapshot['task'],
): CommandCenterClientSnapshot['task'] {
  if (!task) return null;
  const verification = task.verification?.summary || task.outcome;
  return {
    id: task.id,
    objective: task.objective,
    status: task.status,
    simulated: task.simulated,
    waitingPermission: task.status === 'WAITING_PERMISSION' || task.plan.some(step => step.status === 'waiting_permission'),
    active: ACTIVE_TASK.has(task.status),
    steps: liveOpsSteps(task),
    evidence: task.evidence.slice(0, 6),
    errors: task.errors.map(item => item.message).slice(0, 4),
    ...(task.outcome ? { outcome: task.outcome } : {}),
    ...(verification ? { verification } : {}),
  };
}

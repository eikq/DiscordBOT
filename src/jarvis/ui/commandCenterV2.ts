/**
 * Command Center V2 view-model.
 * Presentation-only mapping over existing lab + Command Center snapshots.
 * Does not rebuild CommandCenterRuntime, Core, or schedulers.
 */

import { FORBIDDEN_PRESENTATION_KEYS } from '../presentation/briefing/types';
import type { CommandCenterClientSnapshot } from '../standalone/commandCenterView';
import type { LabMemoryRef, LabPendingConfirmation } from './labUiState';
import type { LiveOpsStep } from './operationsView';

export const COMMAND_CENTER_MODES = [
  'assistant',
  'presenter',
  'operations',
  'memory',
  'intelligence',
  'devices',
] as const;

export type CommandCenterMode = (typeof COMMAND_CENTER_MODES)[number];

export const MODE_LABELS: Record<CommandCenterMode, string> = {
  assistant: 'ASSISTANT',
  presenter: 'PRESENTER',
  operations: 'OPERATIONS',
  memory: 'MEMORY',
  intelligence: 'INTELLIGENCE',
  devices: 'DEVICES',
};

export const RECENT_TASK_LIMIT = 5;

export type GlobalPresence = 'REAL' | 'SIMULATION' | 'DEGRADED' | 'OFFLINE';

export type PresenceView = {
  presence: GlobalPresence;
  label: GlobalPresence;
  hardwareClaim: 'none';
  reason: string;
};

export type RecommendedAction = {
  id: 'grant_permission' | 'review_alert' | 'review_night' | 'ask_jarvis' | 'continue';
  label: string;
  mode: CommandCenterMode;
};

export type LatestRequestView = {
  empty: boolean;
  route: string | null;
  requestId: string | null;
  socialAction: string | null;
  agentic: boolean;
  reason: string | null;
};

export type MemoryItemStatus = 'ACTIVE' | 'SUPERSEDED' | 'FORGOTTEN' | 'EXPIRED' | 'UNKNOWN';

export type MemoryItemView = {
  canonicalId: string;
  type?: string;
  status: MemoryItemStatus;
  provenance: string[];
  confidence?: number;
  domain?: string;
};

export type DeviceItemView = {
  id: string;
  label: string;
  kind: string;
  connectivity: 'online' | 'offline';
  access: 'VIEW';
  runtime: 'SIMULATION' | 'LIVE';
  permissionBoundary: 'VIEW != CONTROL';
  node: string;
};

export type MotionCueKind = 'request-path' | 'narration-target' | 'alert' | 'permission-wait' | 'none';

export type MotionCueView = {
  kind: MotionCueKind;
  animate: boolean;
};

export type LayoutProfile = 'widescreen' | 'notebook' | 'presenter';

const MODE_SET = new Set<string>(COMMAND_CENTER_MODES);
const FORBIDDEN = new Set<string>(FORBIDDEN_PRESENTATION_KEYS);

export function parseCommandCenterMode(value: unknown): CommandCenterMode {
  const raw = String(value || '').trim().toLowerCase();
  return MODE_SET.has(raw) ? (raw as CommandCenterMode) : 'assistant';
}

export function visibleRails(mode: CommandCenterMode): {
  assistantHome: boolean;
  memoryRail: boolean;
  opsRail: boolean;
  presenter: boolean;
} {
  const current = parseCommandCenterMode(mode);
  return {
    assistantHome: current === 'assistant',
    memoryRail: current === 'memory',
    opsRail: current === 'operations' || current === 'intelligence' || current === 'devices',
    presenter: current === 'presenter',
  };
}

export function deriveGlobalPresence(input: {
  simulationMode?: boolean;
  taskSimulated?: boolean;
  perceptionSimulated?: boolean;
  statusReady?: boolean;
  llmReachable?: boolean;
  coreState?: string;
  phase?: string;
}): PresenceView {
  if (input.simulationMode === true || input.taskSimulated === true) {
    return {
      presence: 'SIMULATION',
      label: 'SIMULATION',
      hardwareClaim: 'none',
      reason: 'Events are tagged simulation and are not live hardware',
    };
  }
  if (input.statusReady === false && input.llmReachable === false) {
    return {
      presence: 'OFFLINE',
      label: 'OFFLINE',
      hardwareClaim: 'none',
      reason: 'Host services are not reachable',
    };
  }
  if (
    input.phase === 'degraded'
    || input.phase === 'error'
    || input.coreState === 'degraded'
    || input.coreState === 'error'
    || input.llmReachable === false
    || input.statusReady === false
  ) {
    return {
      presence: 'DEGRADED',
      label: 'DEGRADED',
      hardwareClaim: 'none',
      reason: 'Operating with limited services',
    };
  }
  if (input.llmReachable === true) {
    return {
      presence: 'REAL',
      label: 'REAL',
      hardwareClaim: 'none',
      reason: 'Local software path is live; devices still report their own simulation and VIEW labels',
    };
  }
  return {
    presence: 'OFFLINE',
    label: 'OFFLINE',
    hardwareClaim: 'none',
    reason: 'Status unknown',
  };
}

export function deriveLatestRequest(input: {
  snapshot?: CommandCenterClientSnapshot | null;
  route?: { route: string; socialAction: string; agentic: boolean; reason: string; requestId?: string } | null;
}): LatestRequestView {
  const req = input.snapshot?.request ?? input.route ?? null;
  if (!req) {
    return {
      empty: true,
      route: null,
      requestId: null,
      socialAction: null,
      agentic: false,
      reason: null,
    };
  }
  return {
    empty: false,
    route: req.route,
    requestId: 'requestId' in req ? req.requestId ?? null : null,
    socialAction: req.socialAction,
    agentic: req.agentic,
    reason: req.reason,
  };
}

export function boundedRecentTasks(
  tasks: CommandCenterClientSnapshot['recentTasks'] | undefined,
): CommandCenterClientSnapshot['recentTasks'] {
  return (tasks ?? []).slice(0, RECENT_TASK_LIMIT);
}

export function derivePermissionWait(input: {
  permissionWaiting?: boolean;
  pendingConfirmation?: boolean;
  taskStatus?: string;
  capability?: string;
  taskId?: string;
  stepId?: string;
  risk?: string;
}): {
  waiting: boolean;
  label: 'WAITING_PERMISSION' | null;
  capability?: string;
  taskId?: string;
  stepId?: string;
  risk?: string;
} {
  const waiting = Boolean(
    input.permissionWaiting
    || input.pendingConfirmation
    || input.taskStatus === 'WAITING_PERMISSION',
  );
  return {
    waiting,
    label: waiting ? 'WAITING_PERMISSION' : null,
    ...(input.capability ? { capability: input.capability } : {}),
    ...(input.taskId ? { taskId: input.taskId } : {}),
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.risk ? { risk: input.risk } : {}),
  };
}

export function deriveRecommendedAction(input: {
  permissionWaiting?: boolean;
  pendingConfirmation?: boolean;
  capability?: string;
  hasConversation?: boolean;
  nightPausedForOwner?: boolean;
  alerts?: Array<{ summary: string; severity: string }>;
}): RecommendedAction {
  if (input.permissionWaiting || input.pendingConfirmation) {
    return {
      id: 'grant_permission',
      label: input.capability ? `Grant permission for ${input.capability}` : 'Grant permission',
      mode: 'operations',
    };
  }
  const alert = input.alerts?.find(item => item.severity === 'critical' || item.severity === 'high');
  if (alert) {
    return {
      id: 'review_alert',
      label: `Review alert: ${alert.summary}`,
      mode: 'assistant',
    };
  }
  if (input.nightPausedForOwner) {
    return {
      id: 'review_night',
      label: 'Review Night pause',
      mode: 'operations',
    };
  }
  if (!input.hasConversation) {
    return { id: 'ask_jarvis', label: 'Ask Jarvis', mode: 'assistant' };
  }
  return { id: 'continue', label: 'Continue conversation', mode: 'assistant' };
}

export function deriveMotionCues(input: {
  reducedMotion: boolean;
  busy?: boolean;
  permissionWaiting?: boolean;
  newAlert?: boolean;
  narrationTargetId?: string | null;
}): MotionCueView[] {
  const animate = !input.reducedMotion;
  const cues: MotionCueView[] = [];
  if (input.permissionWaiting) cues.push({ kind: 'permission-wait', animate });
  if (input.newAlert) cues.push({ kind: 'alert', animate });
  if (input.narrationTargetId) cues.push({ kind: 'narration-target', animate });
  if (input.busy) cues.push({ kind: 'request-path', animate });
  return cues.length > 0 ? cues : [{ kind: 'none', animate: false }];
}

export function derivePresenterChrome(input: {
  mode: CommandCenterMode;
  density?: string;
  reducedMotion?: boolean;
}): {
  open: boolean;
  fullscreenReady: boolean;
  emptyState: boolean;
  motion: 'reduced' | 'full';
} {
  const open = parseCommandCenterMode(input.mode) === 'presenter';
  return {
    open,
    fullscreenReady: open,
    emptyState: open && (input.density === 'plain' || !input.density),
    motion: input.reducedMotion ? 'reduced' : 'full',
  };
}

export function deriveLayoutProfile(input: { mode: CommandCenterMode; widthPx?: number }): LayoutProfile {
  if (parseCommandCenterMode(input.mode) === 'presenter') return 'presenter';
  if (input.widthPx != null && input.widthPx <= 1100) return 'notebook';
  return 'widescreen';
}

export function memoryStatus(raw?: string): MemoryItemStatus {
  const value = String(raw || '').toUpperCase();
  if (value === 'ACTIVE' || value === 'SUPERSEDED' || value === 'FORGOTTEN' || value === 'EXPIRED') {
    return value;
  }
  return 'UNKNOWN';
}

export function presentMemoryItems(refs: LabMemoryRef[]): MemoryItemView[] {
  return refs.map(ref => ({
    canonicalId: ref.canonicalId,
    ...(ref.type ? { type: ref.type } : {}),
    status: memoryStatus(ref.status),
    provenance: [...(ref.sourceRefs ?? [])],
    ...(typeof ref.confidence === 'number' ? { confidence: ref.confidence } : {}),
    ...(ref.domain ? { domain: ref.domain } : {}),
  }));
}

export function buildOwnerCorrectionPhrase(
  action: 'remember' | 'forget' | 'change' | 'reject',
  item: { canonicalId: string; factKey?: string; value?: string },
): string {
  if (action === 'forget') return `forget ${item.canonicalId}`;
  if (action === 'reject') return `that is not right ${item.canonicalId}`;
  if (action === 'change') {
    const key = item.factKey || item.canonicalId;
    return `change ${key} to ${item.value || ''}`.trim();
  }
  return `remember ${item.canonicalId}`;
}

export function presentIntelligence(snapshot: CommandCenterClientSnapshot | null | undefined): {
  insufficientData: boolean;
  insufficientLabel: string;
  certificationLabel: string;
  benchmarkLabel: string;
  runtimeSpec: { id: string; version: number } | null;
  traces: CommandCenterClientSnapshot['intelligence']['traces'];
  models: CommandCenterClientSnapshot['intelligence']['models'];
  certifications: CommandCenterClientSnapshot['intelligence']['certifications'];
  candidates: Array<{ id: string; hypothesis: string; status: string }>;
  efficiency: CommandCenterClientSnapshot['intelligence']['efficiency'];
} {
  const intel = snapshot?.intelligence;
  const traces = intel?.traces ?? { count: 0 };
  const analyzerStatus = intel?.analyzer.status ?? 'INSUFFICIENT_DATA';
  const insufficientData = analyzerStatus === 'INSUFFICIENT_DATA' || traces.count === 0;
  const certifications = intel?.certifications ?? [];
  const benchmarks = snapshot?.evolution.benchmarks ?? [];
  const specCandidates = intel?.specCandidates ?? [];
  const evolutionCandidates = snapshot?.evolution.candidates ?? [];
  return {
    insufficientData,
    insufficientLabel: intel?.analyzer.reason || 'INSUFFICIENT_DATA',
    certificationLabel: certifications[0]
      ? `${certifications[0].status} · ${certifications[0].passed}/${certifications[0].total}`
      : 'INSUFFICIENT_DATA',
    benchmarkLabel: benchmarks.length > 0
      ? `${benchmarks.filter(item => item.passed).length}/${benchmarks.length} passed`
      : 'INSUFFICIENT_DATA',
    runtimeSpec: intel?.runtimeSpec ?? null,
    traces,
    models: intel?.models ?? [],
    certifications,
    candidates: [
      ...specCandidates,
      ...evolutionCandidates.map(item => ({
        id: item.id,
        hypothesis: item.hypothesis,
        status: item.status,
      })),
    ],
    efficiency: intel?.efficiency ?? { status: 'INSUFFICIENT_DATA' },
  };
}

export function presentDevices(snapshot: CommandCenterClientSnapshot | null | undefined): {
  empty: boolean;
  liveCamera: boolean;
  visionAuthoritative: boolean;
  perceptionLabel: 'SIMULATION' | string;
  items: DeviceItemView[];
} {
  const items = (snapshot?.devices ?? []).map(device => ({
    id: device.id,
    label: device.label,
    kind: device.kind,
    connectivity: device.status === 'offline' ? 'offline' as const : 'online' as const,
    access: 'VIEW' as const,
    runtime: device.simulated ? 'SIMULATION' as const : 'LIVE' as const,
    permissionBoundary: 'VIEW != CONTROL' as const,
    node: device.node,
  }));
  return {
    empty: items.length === 0,
    liveCamera: snapshot?.perception?.liveCamera ?? false,
    visionAuthoritative: snapshot?.perception?.visionAuthoritative ?? false,
    perceptionLabel: snapshot?.perception?.label ?? 'SIMULATION',
    items,
  };
}

export function activeOpsStep(steps: LiveOpsStep[]): LiveOpsStep | null {
  return steps.find(step => step.state === 'active' || step.state === 'waiting') ?? null;
}

export function operationsCapabilities(input: { stepCaps: string[]; catalogIds: string[] }): string[] {
  const fromSteps = [...new Set(input.stepCaps.filter(Boolean))];
  if (fromSteps.length > 0) return fromSteps;
  return input.catalogIds.slice(0, 12);
}

export function viewModelHasForbiddenKeys(value: unknown): boolean {
  const seen = new Set<object>();
  const walk = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') return false;
    if (seen.has(node as object)) return false;
    seen.add(node as object);
    for (const key of Object.keys(node as object)) {
      if (FORBIDDEN.has(key)) return true;
      if (walk((node as Record<string, unknown>)[key])) return true;
    }
    return false;
  };
  return walk(value);
}

export type CommandCenterV2Input = {
  mode?: unknown;
  snapshot?: CommandCenterClientSnapshot | null;
  conversationText?: string | null;
  modelName?: string | null;
  voiceState?: string | null;
  reducedMotion?: boolean;
  statusReady?: boolean;
  llmReachable?: boolean;
  coreState?: string;
  phase?: string;
  memoryRefs?: LabMemoryRef[];
  pendingConfirmation?: boolean | LabPendingConfirmation | null;
  widthPx?: number;
  busy?: boolean;
  narrationTargetId?: string | null;
  catalogIds?: string[];
};

export type CommandCenterV2View = {
  mode: CommandCenterMode;
  rails: ReturnType<typeof visibleRails>;
  layout: LayoutProfile;
  presence: PresenceView;
  request: LatestRequestView;
  permission: ReturnType<typeof derivePermissionWait>;
  recommended: RecommendedAction;
  motion: MotionCueView[];
  presenter: ReturnType<typeof derivePresenterChrome>;
  recentTasks: CommandCenterClientSnapshot['recentTasks'];
  memory: { items: MemoryItemView[]; empty: boolean };
  intelligence: ReturnType<typeof presentIntelligence>;
  devices: ReturnType<typeof presentDevices>;
  conversation: { text: string | null; empty: boolean };
  activeTask: CommandCenterClientSnapshot['task'];
  modelName: string | null;
  voiceState: string | null;
  alert: { summary: string; severity: string; simulated: boolean } | null;
  capabilities: string[];
  activeStep: LiveOpsStep | null;
};

export function deriveCommandCenterV2(input: CommandCenterV2Input): CommandCenterV2View {
  const mode = parseCommandCenterMode(input.mode);
  const snapshot = input.snapshot ?? null;
  const pending = Boolean(input.pendingConfirmation);
  const permission = derivePermissionWait({
    permissionWaiting: snapshot?.permission.waiting || snapshot?.task?.waitingPermission,
    pendingConfirmation: pending,
    taskStatus: snapshot?.task?.status,
    capability: snapshot?.permission.capability,
    taskId: snapshot?.permission.taskId || snapshot?.task?.id,
    stepId: snapshot?.permission.stepId,
    risk: snapshot?.permission.risk,
  });
  const alerts = snapshot?.notifications ?? [];
  const memoryItems = presentMemoryItems(input.memoryRefs ?? []);
  const inspect = snapshot?.task ?? snapshot?.lastTask ?? null;
  const steps = inspect?.steps ?? [];
  return {
    mode,
    rails: visibleRails(mode),
    layout: deriveLayoutProfile({ mode, widthPx: input.widthPx }),
    presence: deriveGlobalPresence({
      simulationMode: snapshot?.simulationMode,
      taskSimulated: snapshot?.task?.simulated,
      perceptionSimulated: snapshot?.perception?.simulated,
      statusReady: input.statusReady,
      llmReachable: input.llmReachable,
      coreState: input.coreState,
      phase: input.phase,
    }),
    request: deriveLatestRequest({ snapshot, route: null }),
    permission,
    recommended: deriveRecommendedAction({
      permissionWaiting: permission.waiting,
      pendingConfirmation: pending,
      capability: permission.capability,
      hasConversation: Boolean(input.conversationText),
      nightPausedForOwner: Boolean(snapshot?.evolution.night.pausedFor),
      alerts,
    }),
    motion: deriveMotionCues({
      reducedMotion: Boolean(input.reducedMotion),
      busy: input.busy,
      permissionWaiting: permission.waiting,
      newAlert: alerts.some(item => item.severity === 'critical' || item.severity === 'high'),
      narrationTargetId: input.narrationTargetId,
    }),
    presenter: derivePresenterChrome({
      mode,
      density: undefined,
      reducedMotion: input.reducedMotion,
    }),
    recentTasks: boundedRecentTasks(snapshot?.recentTasks),
    memory: { items: memoryItems, empty: memoryItems.length === 0 },
    intelligence: presentIntelligence(snapshot),
    devices: presentDevices(snapshot),
    conversation: {
      text: input.conversationText ?? null,
      empty: !input.conversationText,
    },
    activeTask: snapshot?.task ?? null,
    modelName: input.modelName ?? null,
    voiceState: input.voiceState ?? null,
    alert: alerts[0] ? {
      summary: alerts[0].summary,
      severity: alerts[0].severity,
      simulated: alerts[0].simulated,
    } : null,
    capabilities: operationsCapabilities({
      stepCaps: steps.map(step => step.capability).filter((item): item is string => Boolean(item)),
      catalogIds: input.catalogIds ?? [],
    }),
    activeStep: activeOpsStep(steps),
  };
}

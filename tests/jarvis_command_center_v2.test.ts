import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { FORBIDDEN_PRESENTATION_KEYS } from '../src/jarvis/presentation/briefing/types';
import { parseOwnerCorrection } from '../src/jarvis/memory/ownerCorrection';
import { visibleMotionCues } from '../src/jarvis/ui/presenterMotion';
import {
  COMMAND_CENTER_MODES,
  RECENT_TASK_LIMIT,
  activeOpsStep,
  boundedRecentTasks,
  buildOwnerCorrectionPhrase,
  deriveCommandCenterV2,
  deriveGlobalPresence,
  deriveLatestRequest,
  deriveLayoutProfile,
  deriveMotionCues,
  derivePermissionWait,
  derivePresenterChrome,
  deriveRecommendedAction,
  operationsCapabilities,
  parseCommandCenterMode,
  presentDevices,
  presentIntelligence,
  presentMemoryItems,
  viewModelHasForbiddenKeys,
  visibleRails,
} from '../src/jarvis/ui/commandCenterV2';
import type { MotionCue, PlannedPresentation } from '../src/jarvis/presentation/briefing/types';
import type { LiveOpsStep } from '../src/jarvis/ui/operationsView';
import type { CommandCenterClientSnapshot } from '../src/jarvis/standalone/commandCenterView';

const FORBIDDEN = [...FORBIDDEN_PRESENTATION_KEYS];

function snapshot(partial: Partial<CommandCenterClientSnapshot> = {}): CommandCenterClientSnapshot {
  return {
    simulationMode: false,
    visualState: 'IDLE',
    visualLabel: 'IDLE',
    fresh: false,
    operations: [],
    task: null,
    lastTask: null,
    recentTasks: [],
    evolution: {
      experiences: 0,
      reflections: 0,
      skills: 0,
      failures: 0,
      goals: [],
      lessons: [],
      affect: { valence: 0, confidence: 0 },
      selfModel: [],
      night: {
        status: 'idle',
        stage: null,
        experiencesProcessed: 0,
        reflectionsCreated: 0,
        skillsProposed: 0,
        autoPromoted: false,
      },
      candidates: [],
      productionPromotionAllowed: false,
      benchmarks: [],
      graph: { nodes: 0, edges: 0, empty: true },
      modelAdaptation: { trained: false, candidates: 0 },
    },
    request: null,
    permission: { waiting: false },
    memoryActivity: { experiences: 0, reflections: 0, skills: 0 },
    devices: [],
    notifications: [],
    control: {
    maxAutonomy: 2,
    currentAutonomy: 1,
    researchDepth: 'standard',
    backgroundEvolution: false,
    nightCycle: false,
    proactiveAlerts: true,
    simulationMode: false,
    autonomyLabel: 'suggest',
    maxAutonomyLabel: 'confirm',
  },
    vision: null,
    perception: {
      simulated: true,
      label: 'SIMULATION',
      liveCamera: false,
      visionAuthoritative: false,
      devices: 0,
      memoryCandidates: 0,
    },
    proactive: {
      simulated: true,
      label: 'SIMULATION',
      currentPriority: 'owner_task',
      jobs: [],
      noticePolicy: { mayNotify: true, mayAutoAct: false, mayKillProcesses: false },
      nightV2Pipeline: [],
      autoPromoted: false,
      competingSchedulerAdded: false,
      schedulerCount: 3,
      coordinatorIsScheduler: false,
    },
    intelligence: {
      traces: { count: 0 },
      analyzer: { status: 'INSUFFICIENT_DATA', samples: 0 },
      runtimeSpec: { id: 'spec_baseline_v1', version: 1 },
      specCandidates: [],
      models: [],
      certifications: [],
      efficiency: { status: 'INSUFFICIENT_DATA' },
      artifacts: [],
      scheduler: { competingSchedulerAdded: false, jobIsPermanentPermission: false },
      productionPromotionAllowed: false,
    },
    ...partial,
  };
}

test('command center modes are exactly the six operational modes and default to assistant', () => {
  assert.deepEqual([...COMMAND_CENTER_MODES], [
    'assistant',
    'presenter',
    'operations',
    'memory',
    'intelligence',
    'devices',
  ]);
  assert.equal(parseCommandCenterMode(undefined), 'assistant');
  assert.equal(parseCommandCenterMode('OPERATIONS'), 'operations');
  assert.equal(parseCommandCenterMode('graph'), 'assistant');
  assert.equal(parseCommandCenterMode('core'), 'assistant');
  const rails = visibleRails('assistant');
  assert.equal(rails.assistantHome, true);
  assert.equal(rails.memoryRail, false);
  assert.equal(rails.opsRail, false);
  assert.equal(rails.presenter, false);
  assert.deepEqual(visibleRails('operations'), {
    assistantHome: false,
    memoryRail: false,
    opsRail: true,
    presenter: false,
  });
  assert.equal(visibleRails('memory').memoryRail, true);
  assert.equal(visibleRails('presenter').presenter, true);
  assert.equal(visibleRails('intelligence').opsRail, true);
  assert.equal(visibleRails('devices').opsRail, true);
});

test('latest request and bounded recent tasks stay honest', () => {
  const request = deriveLatestRequest({
    snapshot: snapshot({
      request: {
        route: 'WORK',
        socialAction: 'task',
        agentic: true,
        reason: 'owner asked for system status',
        requestId: 'req-9',
      },
    }),
  });
  assert.equal(request.empty, false);
  assert.equal(request.route, 'WORK');
  assert.equal(request.requestId, 'req-9');
  assert.equal(request.agentic, true);

  const fromAsk = deriveLatestRequest({
    snapshot: snapshot(),
    route: { route: 'CONVERSATION', socialAction: 'reply', agentic: false, reason: 'chat' },
  });
  assert.equal(fromAsk.route, 'CONVERSATION');
  assert.equal(fromAsk.empty, false);

  assert.equal(deriveLatestRequest({ snapshot: snapshot() }).empty, true);

  const many = Array.from({ length: 12 }, (_, index) => ({
    id: `task-${index}`,
    objective: `do ${index}`,
    status: 'COMPLETED',
    simulated: true,
  }));
  const bounded = boundedRecentTasks(many);
  assert.equal(bounded.length, RECENT_TASK_LIMIT);
  assert.equal(RECENT_TASK_LIMIT, 5);
  assert.equal(bounded[0]?.id, 'task-0');
});

test('global presence never labels simulation as REAL or live hardware', () => {
  const sim = deriveGlobalPresence({
    simulationMode: true,
    statusReady: true,
    llmReachable: true,
  });
  assert.equal(sim.presence, 'SIMULATION');
  assert.notEqual(sim.presence, 'REAL');
  assert.equal(sim.hardwareClaim, 'none');
  assert.match(sim.reason, /not live hardware/i);

  const taskSim = deriveGlobalPresence({
    simulationMode: false,
    taskSimulated: true,
    statusReady: true,
    llmReachable: true,
  });
  assert.equal(taskSim.presence, 'SIMULATION');

  const offline = deriveGlobalPresence({
    simulationMode: false,
    statusReady: false,
    llmReachable: false,
  });
  assert.equal(offline.presence, 'OFFLINE');

  const degraded = deriveGlobalPresence({
    simulationMode: false,
    statusReady: true,
    llmReachable: false,
    phase: 'degraded',
  });
  assert.equal(degraded.presence, 'DEGRADED');

  const real = deriveGlobalPresence({
    simulationMode: false,
    taskSimulated: false,
    statusReady: true,
    llmReachable: true,
  });
  assert.equal(real.presence, 'REAL');
  assert.equal(real.hardwareClaim, 'none');

  const perceptionOnly = deriveGlobalPresence({
    simulationMode: false,
    taskSimulated: false,
    perceptionSimulated: true,
    statusReady: true,
    llmReachable: true,
  });
  assert.equal(perceptionOnly.presence, 'REAL');
});

test('permission wait surfaces waiting state and a grant recommendation', () => {
  const wait = derivePermissionWait({
    permissionWaiting: true,
    capability: 'desktop.openApplication',
    taskId: 'task-1',
  });
  assert.equal(wait.waiting, true);
  assert.equal(wait.label, 'WAITING_PERMISSION');
  assert.equal(wait.capability, 'desktop.openApplication');

  const recommended = deriveRecommendedAction({
    permissionWaiting: true,
    capability: 'desktop.openApplication',
    hasConversation: true,
  });
  assert.equal(recommended.id, 'grant_permission');
  assert.match(recommended.label, /Grant permission/i);
  assert.equal(recommended.mode, 'operations');

  const idle = deriveRecommendedAction({ hasConversation: false });
  assert.equal(idle.id, 'ask_jarvis');

  const alert = deriveRecommendedAction({
    hasConversation: true,
    alerts: [{ summary: 'GPU load remaining high', severity: 'critical' }],
  });
  assert.equal(alert.id, 'review_alert');
});

test('presenter chrome is fullscreen-ready and plain density stays an empty state', () => {
  const briefing = derivePresenterChrome({
    mode: 'presenter',
    density: 'briefing',
    reducedMotion: false,
  });
  assert.equal(briefing.open, true);
  assert.equal(briefing.fullscreenReady, true);
  assert.equal(briefing.emptyState, false);

  const plain = derivePresenterChrome({
    mode: 'presenter',
    density: 'plain',
    reducedMotion: true,
  });
  assert.equal(plain.emptyState, true);
  assert.equal(plain.motion, 'reduced');

  assert.equal(derivePresenterChrome({ mode: 'assistant' }).open, false);
  assert.equal(deriveLayoutProfile({ mode: 'presenter' }), 'presenter');
  assert.equal(deriveLayoutProfile({ mode: 'assistant', widthPx: 1920 }), 'widescreen');
  assert.equal(deriveLayoutProfile({ mode: 'operations', widthPx: 1100 }), 'notebook');
});

test('reduced motion disables request-path, alert, permission, and narration animation', () => {
  const animated = deriveMotionCues({
    reducedMotion: false,
    busy: true,
    permissionWaiting: true,
    newAlert: true,
    narrationTargetId: 'section-summary',
  });
  assert.ok(animated.some(item => item.kind === 'request-path' && item.animate === true));
  assert.ok(animated.some(item => item.kind === 'permission-wait' && item.animate === true));
  assert.ok(animated.some(item => item.kind === 'alert' && item.animate === true));
  assert.ok(animated.some(item => item.kind === 'narration-target' && item.animate === true));

  const reduced = deriveMotionCues({
    reducedMotion: true,
    busy: true,
    permissionWaiting: true,
    newAlert: true,
    narrationTargetId: 'section-summary',
  });
  assert.ok(reduced.length > 0);
  assert.ok(reduced.every(item => item.animate === false));

  const planned = {
    density: 'briefing',
    motionTimeline: [
      { atMs: 0, action: 'focus', target: { id: 'a' } },
      { atMs: 10, action: 'pulse', target: { id: 'a' } },
      { atMs: 20, action: 'zoom', target: { id: 'a' } },
    ],
  } as unknown as PlannedPresentation;
  const cues = visibleMotionCues(planned, 50, true) as MotionCue[];
  assert.equal(cues.some(item => item.action === 'pulse' || item.action === 'zoom'), false);
  assert.equal(cues.some(item => item.action === 'focus'), true);
});

test('memory items expose provenance and status without hidden reasoning', () => {
  assert.deepEqual(presentMemoryItems([]), []);
  const items = presentMemoryItems([
    {
      canonicalId: 'fact:owner.city',
      type: 'semantic',
      status: 'ACTIVE',
      domain: 'owner',
      confidence: 0.9,
      sourceRefs: ['episode:1'],
    },
    {
      canonicalId: 'fact:owner.pet',
      status: 'SUPERSEDED',
      sourceRefs: [],
    },
  ]);
  assert.equal(items[0]?.status, 'ACTIVE');
  assert.deepEqual(items[0]?.provenance, ['episode:1']);
  assert.equal(items[1]?.status, 'SUPERSEDED');
  assert.equal(Object.hasOwn(items[0]!, 'hiddenReasoning'), false);
  assert.equal(viewModelHasForbiddenKeys(items), false);

  const forget = buildOwnerCorrectionPhrase('forget', { canonicalId: 'fact:owner.city' });
  assert.equal(parseOwnerCorrection(forget).action, 'forget');
  const remember = buildOwnerCorrectionPhrase('remember', { canonicalId: 'fact:owner.city' });
  assert.equal(parseOwnerCorrection(remember).action, 'remember');
  const change = buildOwnerCorrectionPhrase('change', {
    canonicalId: 'fact:owner.city',
    factKey: 'owner.city',
    value: 'Chiang Mai',
  });
  assert.equal(parseOwnerCorrection(change).action, 'change');
});

test('intelligence reports INSUFFICIENT_DATA when evidence is absent', () => {
  const empty = presentIntelligence(snapshot());
  assert.equal(empty.insufficientData, true);
  assert.equal(empty.insufficientLabel, 'INSUFFICIENT_DATA');
  assert.equal(empty.certificationLabel, 'INSUFFICIENT_DATA');
  assert.equal(empty.benchmarkLabel, 'INSUFFICIENT_DATA');
  assert.deepEqual(empty.models, []);

  const present = presentIntelligence(snapshot({
    intelligence: {
      ...snapshot().intelligence,
      traces: { count: 4, lastRoute: 'CONVERSATION', lastModelProfileId: 'qwen-local' },
      analyzer: { status: 'ok', samples: 4 },
      models: [{ id: 'qwen-local', trustTier: 'STANDARD' }],
      certifications: [{ modelProfileId: 'qwen-local', status: 'FIXTURE_ONLY', passed: 3, total: 3 }],
      efficiency: { status: 'ok', p50Ms: 40, p95Ms: 90 },
      specCandidates: [{ id: 'cand-1', hypothesis: 'try a slower night spec', status: 'DRAFT' }],
    },
    evolution: {
      ...snapshot().evolution,
      benchmarks: [{ id: 'bench-1', category: 'routing', passed: true, detail: 'fixture' }],
    },
  }));
  assert.equal(present.insufficientData, false);
  assert.equal(present.models[0]?.id, 'qwen-local');
  assert.match(present.certificationLabel, /FIXTURE_ONLY/);
  assert.equal(present.candidates[0]?.status, 'DRAFT');
});

test('devices stay honest about VIEW vs control and simulation vs live', () => {
  assert.deepEqual(presentDevices(snapshot()).items, []);
  assert.equal(presentDevices(snapshot()).empty, true);

  const devices = presentDevices(snapshot({
    devices: [
      {
        id: 'cam-1',
        label: 'Front door',
        kind: 'cctv',
        status: 'online',
        node: 'AVAILABLE',
        simulated: true,
      },
      {
        id: 'lamp-1',
        label: 'Desk lamp',
        kind: 'light',
        status: 'offline',
        node: 'UNAVAILABLE',
        simulated: false,
      },
    ],
    perception: {
      simulated: true,
      label: 'SIMULATION',
      liveCamera: false,
      visionAuthoritative: false,
      devices: 2,
      memoryCandidates: 0,
    },
  }));
  assert.equal(devices.empty, false);
  assert.equal(devices.items[0]?.connectivity, 'online');
  assert.equal(devices.items[0]?.access, 'VIEW');
  assert.equal(devices.items[0]?.runtime, 'SIMULATION');
  assert.notEqual(devices.items[0]?.runtime, 'LIVE');
  assert.notEqual(devices.items[0]?.access, 'CONTROL');
  assert.match(devices.items[0]?.permissionBoundary || '', /VIEW != CONTROL/);
  assert.equal(devices.items[1]?.connectivity, 'offline');
  assert.equal(devices.liveCamera, false);
  assert.equal(devices.visionAuthoritative, false);
});

test('operations DAG highlights the active or permission-wait step', () => {
  const steps: LiveOpsStep[] = [
    { id: 's1', index: '01', title: 'plan', state: 'done', capability: 'system.status' },
    { id: 's2', index: '02', title: 'open', state: 'waiting', capability: 'desktop.openApplication' },
    { id: 's3', index: '03', title: 'verify', state: 'pending' },
  ];
  assert.equal(activeOpsStep(steps)?.id, 's2');
  assert.deepEqual(operationsCapabilities({
    stepCaps: ['system.status', 'desktop.openApplication', 'system.status'],
    catalogIds: ['lab.ping'],
  }), ['system.status', 'desktop.openApplication']);
});

test('aggregated v2 view model is consistent and never exposes hidden reasoning', () => {
  const view = deriveCommandCenterV2({
    mode: 'operations',
    snapshot: snapshot({
      simulationMode: true,
      request: { route: 'WORK', socialAction: 'task', agentic: true, reason: 'status', requestId: 'req-1' },
      permission: { waiting: true, capability: 'desktop.openApplication', taskId: 't1' },
      recentTasks: [{ id: 'old', objective: 'prior', status: 'COMPLETED', simulated: true }],
      task: {
        id: 't1',
        objective: 'Open notes',
        status: 'WAITING_PERMISSION',
        waitingPermission: true,
        active: true,
        simulated: true,
        steps: [{ id: 's2', index: '01', title: 'open', state: 'waiting', capability: 'desktop.openApplication' }],
        evidence: [],
        errors: [],
        verification: 'awaiting grant',
      },
    }),
    conversationText: 'Open notes',
    modelName: 'qwen-local',
    voiceState: 'idle',
    reducedMotion: false,
    statusReady: true,
    llmReachable: true,
    memoryRefs: [],
    pendingConfirmation: true,
  });
  assert.equal(view.mode, 'operations');
  assert.equal(view.presence.presence, 'SIMULATION');
  assert.equal(view.request.route, 'WORK');
  assert.equal(view.permission.waiting, true);
  assert.equal(view.recentTasks.length, 1);
  assert.equal(view.recommended.id, 'grant_permission');
  assert.equal(view.intelligence.insufficientData, true);
  assert.equal(view.memory.empty, true);
  assert.equal(view.devices.empty, true);
  assert.equal(viewModelHasForbiddenKeys(view), false);
  for (const key of FORBIDDEN) {
    assert.equal(Object.hasOwn(view, key), false, key);
  }
});

test('lab UI sources stay Discord-free and switch one operational mode at a time', () => {
  const root = path.join(process.cwd(), 'src', 'jarvis', 'ui');
  const files = [
    path.join(root, 'JarvisLabPage.tsx'),
    path.join(root, 'commandCenterV2.ts'),
    path.join(root, 'CommandCenterModeShell.tsx'),
    path.join(root, 'CommandCenterPanels.tsx'),
    path.join(root, 'PresenterBriefing.tsx'),
  ];
  const discord = /from\s+['"](?:discord(?:\.js)?|@discordjs\/)['"]/u;
  const page = fs.readFileSync(files[0]!, 'utf8');
  const shell = fs.readFileSync(files[2]!, 'utf8');
  const css = fs.readFileSync(path.join(root, 'jarvis-lab.css'), 'utf8');
  assert.match(page, /CommandCenterModeNav/);
  assert.match(page, /operationalMode/);
  assert.match(page, /data-mode/);
  assert.match(page, /data-presence/);
  assert.match(page, /jcc-presence-chip/);
  assert.match(page, /CommandCenterModeShell/);
  assert.doesNotMatch(page, /<CommandCenterPanels[\s\S]*snapshot=\{commandCenter\}/);
  assert.match(shell, /jcc-modes/);
  assert.match(shell, /ASSISTANT/);
  assert.match(shell, /PRESENTER/);
  assert.match(shell, /OPERATIONS/);
  assert.match(shell, /MEMORY/);
  assert.match(shell, /INTELLIGENCE/);
  assert.match(shell, /DEVICES/);
  assert.match(shell, /INSUFFICIENT_DATA/);
  assert.match(shell, /No conversation this session/);
  assert.match(shell, /No canonical memory attached/);
  assert.match(shell, /jcc-presenter--fullscreen|fullscreenReady/);
  assert.match(css, /jcc-presence-chip--simulation/);
  assert.match(css, /jcc-presence-chip--real/);
  assert.match(css, /jcc-mode-motion/);
  assert.match(css, /data-layout="presenter"|\[data-mode="presenter"\]/);
  assert.match(css, /min-width:\s*1600px/);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(discord.test(source), false, file);
    assert.doesNotMatch(source, /chainOfThought/);
    assert.doesNotMatch(source, /hiddenReasoning:\s*true/);
  }
});

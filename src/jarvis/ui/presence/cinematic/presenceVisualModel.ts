import type { LabResearchSnapshot } from '../../labViewModels';
import type { LiveOpsStep } from '../../operationsView';
import type { PresenceHudKind, PresencePhase } from '../presenceRuntime';
import { derivePresenceHud } from '../presenceRuntime';
import { presenceCoreMotion, type PresenceCoreMotion } from './coreMotion';
import { composePresenceHud, permissionSupersedesResearch, type PresenceHudSlot } from './hudComposition';
import { parsePresenceReplay, replayResearchAt, type PresenceReplayState } from './cinematicReplay';
import { researchLiveFromStage, researchStageFromEvent, type ResearchVisualStage } from './researchEvents';
import {
  honestTaskProgress,
  presentResearch,
  type HonestProgress,
  type PresenceResearchView,
} from './researchPresentation';
import type { PresenceQualityTier } from './presenceQuality';
import { parsePresenceVisualScene, presenceVisualFixture, type PresenceVisualScene } from './visualFixtures';

export type PresenceCapabilityNode = {
  id: string;
  label: string;
  kind: 'app' | 'step' | 'monitor';
  state: LiveOpsStep['state'] | 'active';
};

export type PresenceVisualInput = {
  phase: PresencePhase;
  hudKind: PresenceHudKind;
  search?: string;
  lastAsk?: string;
  emergency?: boolean;
  waitingPermission?: boolean;
  waitingOwnerInput?: boolean;
  taskActive?: boolean;
  verificationComplete?: boolean;
  research?: LabResearchSnapshot | null;
  researchLive?: boolean;
  researchStage?: ResearchVisualStage | null;
  replayElapsedMs?: number;
  systemAsked?: boolean;
  reminderPending?: boolean;
  reminderActive?: boolean;
  cctvAsked?: boolean;
  mediaAsked?: boolean;
  desktopAsked?: boolean;
  placementUnverified?: boolean;
  attentionCount?: number;
  stepsDone?: number;
  stepsTotal?: number;
  planSteps?: LiveOpsStep[];
  quality?: PresenceQualityTier;
  reducedMotion?: boolean;
};

export type PresenceVisualModel = {
  phase: PresencePhase;
  motion: PresenceCoreMotion;
  hud: PresenceHudSlot | null;
  research: PresenceResearchView | null;
  progress: HonestProgress;
  planSteps: LiveOpsStep[];
  capabilityNodes: PresenceCapabilityNode[];
  fixture: PresenceVisualScene | null;
  replay: PresenceReplayState | null;
  fixtureLabel: 'DEVELOPMENT FIXTURE' | 'DEVELOPMENT REPLAY' | null;
  showComposer: boolean;
  quietIdle: boolean;
};

export function latestResearchStage(events: Array<{
  type: string;
  visualState?: string;
  level?: string;
  payload?: Record<string, unknown>;
  summary?: string;
}>): ResearchVisualStage | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const stage = researchStageFromEvent(events[index]!);
    if (stage) return stage;
  }
  return null;
}

export function applicationLabelFromAsk(lastAsk?: string): string | null {
  if (!lastAsk) return null;
  const match = lastAsk.match(/\b(?:open|focus|move|bring)\s+(?:it|that|the\s+)?([a-z0-9][a-z0-9 .+-]{1,40})/i);
  const label = match?.[1]?.trim();
  if (label && /^(it|that|the|back|to|on)$/i.test(label)) return null;
  return label || null;
}

export function monitorLabelFromAsk(lastAsk?: string, placementUnverified?: boolean): string | null {
  if (placementUnverified) return 'PLACEMENT UNVERIFIED';
  if (!lastAsk) return null;
  const match = lastAsk.match(/\b(notebook|right|left|primary|main|internal|laptop)\s+(?:monitor|display|screen)\b/i)
    || lastAsk.match(/\b(?:monitor|display|screen)\b/i);
  return match?.[1] ? `${match[1]} monitor` : match ? 'target monitor' : null;
}

export function composePresenceVisual(input: PresenceVisualInput): PresenceVisualModel {
  const scene = parsePresenceVisualScene(input.search ?? '');
  const replayQuery = parsePresenceReplay(input.search ?? '');
  const replay = replayQuery ? replayResearchAt(input.replayElapsedMs ?? 0) : null;
  const fixture = scene ? presenceVisualFixture(scene) : null;
  const phase = fixture?.phase ?? (replay && !replay.complete ? 'RESEARCHING' : input.phase);
  const emergency = fixture?.emergency ?? Boolean(input.emergency);
  const waitingPermission = fixture?.waitingPermission ?? Boolean(input.waitingPermission);
  const researchLive = Boolean(replay && !replay.complete) || (fixture?.researchLive ?? Boolean(input.researchLive));
  const systemAsked = fixture?.systemAsked ?? Boolean(input.systemAsked);
  const reminderActive = fixture?.reminderActive ?? Boolean(input.reminderActive);
  const hudKind = fixture || replay
    ? derivePresenceHud({
      phase,
      waitingPermission,
      waitingOwnerInput: input.waitingOwnerInput,
      taskActive: fixture?.taskActive ?? input.taskActive,
      verificationComplete: scene === 'verified',
      researchActive: researchLive,
      systemAsked,
      reminderPending: reminderActive,
      reminderActive,
      cctvAsked: input.cctvAsked,
      mediaAsked: input.mediaAsked,
      desktopAsked: input.desktopAsked || scene === 'open-application',
      attentionCount: emergency ? 1 : input.attentionCount,
    })
    : input.hudKind;

  const hud = composePresenceHud({
    kind: hudKind,
    permission: waitingPermission,
    emergency,
    phase,
  });

  const researchSnapshot = replay?.snapshot ?? fixture?.research ?? input.research ?? null;
  const allowResearch = !permissionSupersedesResearch(hud) && !emergency && (
    Boolean(replay)
    || (researchLive && (phase === 'RESEARCHING' || researchLive))
  );
  const research = allowResearch
    ? presentResearch(researchSnapshot, {
      live: researchLive,
      stage: replay?.stage ?? input.researchStage,
      quality: input.quality,
    })
    : null;

  const planSteps = fixture?.planSteps ?? input.planSteps ?? [];
  const appLabel = fixture?.applicationLabel ?? applicationLabelFromAsk(input.lastAsk);
  const monitorLabel = monitorLabelFromAsk(input.lastAsk, input.placementUnverified);
  const desktopPhase = phase === 'PLANNING' || phase === 'EXECUTING' || phase === 'VERIFYING';
  const capabilityNodes: PresenceCapabilityNode[] = [
    ...planSteps.map(step => ({ id: step.id, label: step.title, kind: 'step' as const, state: step.state })),
    ...(appLabel && desktopPhase
      ? [{
        id: `app:${appLabel}`,
        label: appLabel,
        kind: 'app' as const,
        state: input.placementUnverified ? 'failed' as const : phase === 'VERIFYING' ? 'done' as const : 'active' as const,
      }]
      : []),
    ...(monitorLabel && desktopPhase
      ? [{
        id: `monitor:${monitorLabel}`,
        label: monitorLabel,
        kind: 'monitor' as const,
        state: input.placementUnverified ? 'failed' as const : phase === 'VERIFYING' ? 'done' as const : 'active' as const,
      }]
      : []),
  ];

  return {
    phase,
    motion: presenceCoreMotion(phase, Boolean(input.reducedMotion)),
    hud,
    research,
    progress: honestTaskProgress({
      stepsDone: input.stepsDone ?? planSteps.filter(step => step.state === 'done').length,
      stepsTotal: input.stepsTotal ?? (planSteps.length || undefined),
      phaseLabel: phase === 'EXECUTING' ? 'Executing' : phase === 'VERIFYING' ? 'Verifying' : undefined,
    }),
    planSteps,
    capabilityNodes,
    fixture: scene,
    replay,
    fixtureLabel: replay ? 'DEVELOPMENT REPLAY' : fixture ? 'DEVELOPMENT FIXTURE' : null,
    showComposer: !(fixture?.ambient) && phase !== 'EMERGENCY_STOP',
    quietIdle: phase === 'IDLE' && !research && !waitingPermission && !emergency && hudKind === 'none' && !replay,
  };
}

export function researchActiveFromRuntime(input: {
  phase: PresencePhase;
  liveStage?: ResearchVisualStage | null;
  currentAskResearch?: boolean;
}): boolean {
  if (input.phase === 'RESEARCHING') return true;
  if (input.currentAskResearch && researchLiveFromStage(input.liveStage ?? null)) return true;
  return researchLiveFromStage(input.liveStage ?? null) && input.currentAskResearch === true;
}

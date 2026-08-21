import type { LabResearchSnapshot } from '../../labViewModels';
import type { PresenceHudKind, PresencePhase } from '../presenceRuntime';
import { derivePresenceHud } from '../presenceRuntime';
import { presenceCoreMotion, type PresenceCoreMotion } from './coreMotion';
import { composePresenceHud, permissionSupersedesResearch, type PresenceHudSlot } from './hudComposition';
import { researchLiveFromStage, researchStageFromEvent, type ResearchVisualStage } from './researchEvents';
import {
  honestTaskProgress,
  presentResearch,
  type HonestProgress,
  type PresenceResearchView,
} from './researchPresentation';
import type { PresenceQualityTier } from './presenceQuality';
import { parsePresenceVisualScene, presenceVisualFixture, type PresenceVisualScene } from './visualFixtures';

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
  systemAsked?: boolean;
  reminderPending?: boolean;
  reminderActive?: boolean;
  cctvAsked?: boolean;
  mediaAsked?: boolean;
  desktopAsked?: boolean;
  attentionCount?: number;
  stepsDone?: number;
  stepsTotal?: number;
  quality?: PresenceQualityTier;
  reducedMotion?: boolean;
};

export type PresenceVisualModel = {
  phase: PresencePhase;
  motion: PresenceCoreMotion;
  hud: PresenceHudSlot | null;
  research: PresenceResearchView | null;
  progress: HonestProgress;
  fixture: PresenceVisualScene | null;
  fixtureLabel: 'DEVELOPMENT FIXTURE' | null;
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

export function composePresenceVisual(input: PresenceVisualInput): PresenceVisualModel {
  const scene = parsePresenceVisualScene(input.search ?? '');
  const fixture = scene ? presenceVisualFixture(scene) : null;
  const phase = fixture?.phase ?? input.phase;
  const emergency = fixture?.emergency ?? Boolean(input.emergency);
  const waitingPermission = fixture?.waitingPermission ?? Boolean(input.waitingPermission);
  const researchLive = fixture?.researchLive ?? Boolean(input.researchLive);
  const systemAsked = fixture?.systemAsked ?? Boolean(input.systemAsked);
  const reminderActive = fixture?.reminderActive ?? Boolean(input.reminderActive);
  const hudKind = fixture
    ? derivePresenceHud({
      phase,
      waitingPermission,
      waitingOwnerInput: input.waitingOwnerInput,
      taskActive: fixture.taskActive,
      verificationComplete: scene === 'verified',
      researchActive: fixture.researchLive,
      systemAsked,
      reminderPending: reminderActive,
      reminderActive,
      cctvAsked: input.cctvAsked,
      mediaAsked: input.mediaAsked,
      desktopAsked: input.desktopAsked,
      attentionCount: emergency ? 1 : input.attentionCount,
    })
    : input.hudKind;

  const hud = composePresenceHud({
    kind: hudKind,
    permission: waitingPermission,
    emergency,
    phase,
  });

  const researchSnapshot = fixture?.research ?? input.research ?? null;
  const allowResearch = researchLive && !permissionSupersedesResearch(hud) && !emergency && (phase === 'RESEARCHING' || researchLive);
  const research = allowResearch
    ? presentResearch(researchSnapshot, {
      live: researchLive,
      stage: input.researchStage,
      quality: input.quality,
    })
    : null;

  return {
    phase,
    motion: presenceCoreMotion(phase, Boolean(input.reducedMotion)),
    hud,
    research,
    progress: honestTaskProgress({
      stepsDone: input.stepsDone,
      stepsTotal: input.stepsTotal,
      phaseLabel: phase === 'EXECUTING' ? 'Executing' : phase === 'VERIFYING' ? 'Verifying' : undefined,
    }),
    fixture: scene,
    fixtureLabel: fixture ? 'DEVELOPMENT FIXTURE' : null,
    showComposer: !(fixture?.ambient) && phase !== 'EMERGENCY_STOP',
    quietIdle: phase === 'IDLE' && !research && !waitingPermission && !emergency && hudKind === 'none',
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

export type {
  MotionCue,
  NarrationSegment,
  PlainPresentation,
  PlannedPresentation,
  PresentationCard,
  PresentationDensity,
  PresentationFollowUp,
  PresentationFollowUpId,
  PresentationInput,
  PresentationMode,
  PresentationModel,
  PresentationSection,
} from './types';
export { FORBIDDEN_PRESENTATION_KEYS, PRESENTATION_DENSITIES, PRESENTATION_MODES } from './types';
export { planPresentation, shouldBuildRichPresentation } from './planner';
export { buildPresentationModel } from './model';
export { buildNarrationSegments, estimateNarrationMs, scaleNarrationToSpeech, spokenSummaryFrom } from './narration';
export { activeMotionCues, buildMotionTimeline, motionTargetsOf } from './motion';
export { applyBriefingFollowUp, defaultFollowUps, isPresentationFollowUp } from './followUp';
export { presentationHasForbiddenKeys, sanitizePlannedPresentation, sanitizePresentationText } from './sanitize';
export { isRichPresentation, runPresentationPipeline, spokenTextFor } from './pipeline';

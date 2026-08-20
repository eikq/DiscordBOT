import { buildPresentationModel } from './model';
import { scaleNarrationToSpeech } from './narration';
import { planPresentation, shouldBuildRichPresentation } from './planner';
import { sanitizePlannedPresentation } from './sanitize';
import type { PlannedPresentation, PresentationInput } from './types';

export type PresentationPipelineOptions = {
  reducedMotion?: boolean;
  spokenMs?: number;
};

export function runPresentationPipeline(
  input: PresentationInput,
  options: PresentationPipelineOptions = {},
): PlannedPresentation {
  const plan = planPresentation(input);
  if (!shouldBuildRichPresentation(plan)) {
    return { density: 'plain' };
  }
  const model = buildPresentationModel(input, plan, { reducedMotion: options.reducedMotion });
  if (options.spokenMs) {
    model.narrationSegments = scaleNarrationToSpeech(model.narrationSegments, options.spokenMs);
  }
  return sanitizePlannedPresentation(model);
}

export function spokenTextFor(planned: PlannedPresentation, fallback: string): string {
  if (planned.density === 'plain') return fallback;
  return planned.spokenSummary || fallback;
}

export function isRichPresentation(value: PlannedPresentation | undefined): value is Exclude<PlannedPresentation, { density: 'plain' }> {
  return Boolean(value && value.density !== 'plain');
}

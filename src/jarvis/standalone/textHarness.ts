import { FactPreservingPresentationEngine } from '../presentation/PresentationEngine';
import type { PresentationEngine } from '../presentation/PresentationEngine';
import { defaultJarvisPresentation, withPersona, withVoice } from '../presentation/compatibility';
import type { PresentationProfile, PresentedResponse } from '../presentation/types';
import { createJarvisRequest } from '../core/request';
import type { PendingConfirmation } from '../capabilities/actions';
import type { JarvisCore, JarvisCoreResult, JarvisRequest } from '../core/types';
import { LocalLlmJarvisCore } from './LocalLlmJarvisCore';
import { LocalLlmProvider } from '../../bot/llm/LocalLlmProvider';
import { CANONICAL_LLM_BASE_URL, CANONICAL_LLM_MODEL } from '../../bot/llm/canonicalRuntime';
import type { LlmTurnMetrics, TurnTimings } from './turnTimings';

export type StandaloneTextTurnInput = {
  text: string;
  requestId?: string;
  sessionId?: string;
  language?: string;
  personaProfileId?: string;
  voiceProfileId?: string;
  presentation?: PresentationProfile;
  capabilities?: string[];
  capabilityCalls?: JarvisRequest['capabilityCalls'];
  actionOnly?: boolean;
  presetActionResults?: JarvisRequest['presetActionResults'];
  actionSource?: JarvisRequest['actionSource'];
};

export type StandaloneTextTurnOutput = {
  request: JarvisRequest;
  result: JarvisCoreResult;
  presented: PresentedResponse;
  timings: TurnTimings;
  llm?: LlmTurnMetrics;
  prompt?: { systemChars: number; userChars: number };
  pendingConfirmation?: PendingConfirmation;
};

export function standalonePresentation(input: StandaloneTextTurnInput): PresentationProfile {
  if (input.presentation) return input.presentation;
  let profile = defaultJarvisPresentation();
  if (input.personaProfileId) profile = withPersona(profile, input.personaProfileId);
  if (input.voiceProfileId) profile = withVoice(profile, input.voiceProfileId);
  return profile;
}

export async function runStandaloneTextTurn(
  input: StandaloneTextTurnInput,
  options: {
    core?: JarvisCore;
    engine?: PresentationEngine;
    onDraft?: (accumulated: string, delta: string) => void;
  } = {},
): Promise<StandaloneTextTurnOutput> {
  const presentation = standalonePresentation(input);
  const request = createJarvisRequest({
    text: input.text,
    requestId: input.requestId,
    sessionId: input.sessionId ?? 'standalone',
    source: 'desktop',
    language: input.language,
    presentation,
    capabilities: input.capabilities ?? [],
    capabilityCalls: input.capabilityCalls,
    actionOnly: input.actionOnly,
    presetActionResults: input.presetActionResults,
    actionSource: input.actionSource,
  });
  const core = options.core ?? new LocalLlmJarvisCore(new LocalLlmProvider(
    process.env.JARVIS_LLM_BASE_URL || process.env.LOCAL_QWEN_BASE_URL || CANONICAL_LLM_BASE_URL,
    process.env.JARVIS_LLM_MODEL || process.env.LOCAL_QWEN_MODEL || CANONICAL_LLM_MODEL,
  ));
  const engine = options.engine ?? new FactPreservingPresentationEngine();
  const timedCore = core as JarvisCore & { handleTimed?: LocalLlmJarvisCore['handleTimed'] };
  const started = Date.now();
  const timed = timedCore.handleTimed
    ? await timedCore.handleTimed(request, { onDraft: options.onDraft })
    : { result: await core.handle(request), timings: { totalMs: 0 } };
  const presentStarted = Date.now();
  const presented = await engine.render(timed.result, presentation, {
    sessionId: request.clientContext.sessionId,
  });
  const presentationMs = Date.now() - presentStarted;
  const timings: TurnTimings = {
    ...timed.timings,
    presentationMs,
    totalMs: Date.now() - started,
  };
  return {
    request,
    result: timed.result,
    presented,
    timings,
    ...('llm' in timed ? { llm: timed.llm } : {}),
    ...('prompt' in timed ? { prompt: timed.prompt } : {}),
    ...('pendingConfirmation' in timed && timed.pendingConfirmation
      ? { pendingConfirmation: timed.pendingConfirmation }
      : {}),
  };
}

/**
 * Maps classified voice families to structured intent.
 * Families are cue clusters, not a phrase switch.
 */

import {
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_PLACE_WINDOW,
  SYSTEM_STATUS,
} from '../capabilities/actions/constants';
import { RESEARCH_COMPARE, RESEARCH_CURRENT } from '../research/constants';
import { catalogHas } from './catalog';
import type { CompactCapability, IntentResolution, InteractionContext } from './types';
import { classifyVoiceFamily, type VoiceSlots } from './voiceFamilies';

export function routeVoiceFamily(
  text: string,
  options: {
    catalog: CompactCapability[];
    context?: InteractionContext | null;
  },
): IntentResolution | null {
  const slots = classifyVoiceFamily(text);
  return resolveVoiceSlots(slots, text, options);
}

export function resolveVoiceSlots(
  slots: VoiceSlots,
  text: string,
  options: {
    catalog: CompactCapability[];
    context?: InteractionContext | null;
  },
): IntentResolution | null {
  const catalog = options.catalog;
  const context = options.context;

  switch (slots.family) {
    case 'WAKE':
      return conversation("I'm here.", 'WAKE', true);
    case 'UNSUPPORTED_COMPUTER_USE':
      return unsupported(
        'UNSUPPORTED_DESKTOP_SCOPE',
        'That would require CLICK, TYPE, or SUBMIT, which is not enabled. I can open an allowlisted app or site.',
      );
    case 'MEDIA_UNSUPPORTED':
      return unsupported(
        'UNSUPPORTED_MEDIA_CONTROL',
        'Opening YouTube is not the same as controlling playback. Play, pause, search, upload, and publish stay unavailable until those capabilities are certified.',
      );
    case 'SYSTEM_STATUS':
      if (catalogHas(catalog, SYSTEM_STATUS)) {
        return capability(SYSTEM_STATUS, {}, 'VOICE_SYSTEM_STATUS');
      }
      return null;
    case 'RESEARCH':
      if (!slots.query || slots.query.length < 3) {
        return clarification('What topic should I research?', 'AMBIGUOUS_RESEARCH');
      }
      if (catalogHas(catalog, RESEARCH_CURRENT)) {
        return capability(RESEARCH_CURRENT, {
          query: slots.query,
          officialOnly: Boolean(slots.officialOnly),
          freshness: /latest|ล่าสุด|current/iu.test(text) ? 'latest' : 'any',
          depth: slots.researchDepth ?? 'standard',
        }, 'VOICE_RESEARCH');
      }
      return null;
    case 'RESEARCH_FOLLOWUP':
      return researchFollowup(slots, text, catalog, context);
    case 'CONVERSATION_STATUS':
      return conversation('I will answer from current runtime state only.', 'CONVERSATION_STATUS', true);
    case 'SELF_KNOWLEDGE':
    case 'SELF_GAP':
    case 'CCTV_PREPARE':
      return null;
    case 'TASK_STATUS':
      return conversation('I will report the current WorkAgent step and evidence, not a guessed percentage.', 'TASK_STATUS', true);
    case 'CANCEL_TASK':
      return conversation('I will cancel the current bounded task. This is not Emergency Stop.', 'CANCEL_TASK', true);
    case 'WORK_CONTINUE':
      return conversation('I will continue the current task with the same authority and bounded retries.', 'WORK_CONTINUE', true);
    case 'CORRECTION':
      return correction(slots, text, catalog, context);
    case 'MEMORY':
      return conversation('Memory writes still go through the existing memory policy. I will not store web text as an owner memory unless you confirm that preference.', 'MEMORY_POLICY', false);
    case 'EMERGENCY_STOP':
      return conversation('Emergency Stop requires the existing strong confirmation latch.', 'EMERGENCY_STOP', true);
    default:
      return null;
  }
}

function researchFollowup(
  slots: VoiceSlots,
  text: string,
  catalog: CompactCapability[],
  context?: InteractionContext | null,
): IntentResolution | null {
  const hasResearch = Boolean(context?.recentResearchQuery || context?.lastCapabilityId?.startsWith('research.'));
  if (!hasResearch) {
    return clarification('I do not have a current research session. What should I look up?', 'NO_RESEARCH_CONTEXT');
  }
  if (/disagree|conflict|ขัดแย้ง|why do you trust|official source|source official/iu.test(text) && catalogHas(catalog, RESEARCH_COMPARE)) {
    return capability(RESEARCH_COMPARE, { sourceIds: [] }, 'VOICE_RESEARCH_FOLLOWUP');
  }
  if (catalogHas(catalog, RESEARCH_CURRENT)) {
    return capability(RESEARCH_CURRENT, {
      query: context?.recentResearchQuery || slots.query || text,
      officialOnly: /official|ทางการ/iu.test(text),
      reuseLast: true,
      freshness: 'latest',
    }, 'VOICE_RESEARCH_FOLLOWUP');
  }
  return conversation('I will stay on the current research context.', 'RESEARCH_FOLLOWUP', true);
}

function correction(
  slots: VoiceSlots,
  text: string,
  catalog: CompactCapability[],
  context?: InteractionContext | null,
): IntentResolution | null {
  const display = slots.display;
  const app = slots.resources.find(item => item.applicationId)?.applicationId
    || context?.lastApplicationId;
  if (display && app && catalogHas(catalog, DESKTOP_PLACE_WINDOW)) {
    return capability(DESKTOP_PLACE_WINDOW, { applicationId: app, display }, 'VOICE_CORRECTION_DISPLAY');
  }
  if (display && catalogHas(catalog, DESKTOP_OPEN_SCOPED_RESOURCE) && (app || slots.resources[0])) {
    const resource = slots.resources[0];
    return capability(DESKTOP_OPEN_SCOPED_RESOURCE, {
      kind: resource?.kind || 'application',
      ...(app ? { applicationId: app } : {}),
      ...(resource?.url ? { url: resource.url } : {}),
      label: resource?.label || app,
      display,
    }, 'VOICE_CORRECTION_DISPLAY');
  }
  if (context?.recentResearchQuery && /official|ทางการ/iu.test(text) && catalogHas(catalog, RESEARCH_CURRENT)) {
    return capability(RESEARCH_CURRENT, {
      query: context.recentResearchQuery,
      officialOnly: true,
      reuseLast: true,
    }, 'VOICE_CORRECTION_RESEARCH');
  }
  return clarification('Which part should I change?', 'AMBIGUOUS_CORRECTION');
}

function capability(capabilityId: string, args: Record<string, unknown>, reasonCode: string): IntentResolution {
  return {
    kind: 'CAPABILITY',
    capabilityId,
    arguments: args,
    confidence: 'HIGH',
    reasonCode,
    consumed: true,
    source: 'heuristic',
    actionClass: 'ACTIONABLE',
  };
}

function conversation(userMessage: string, reasonCode: string, consumed: boolean): IntentResolution {
  return {
    kind: 'CONVERSATION',
    confidence: 'HIGH',
    reasonCode,
    userMessage,
    consumed,
    source: 'heuristic',
    actionClass: 'CONVERSATION',
  };
}

function unsupported(reasonCode: string, userMessage: string): IntentResolution {
  return {
    kind: 'UNSUPPORTED',
    confidence: 'HIGH',
    reasonCode,
    userMessage,
    consumed: true,
    source: 'heuristic',
    actionClass: 'ACTIONABLE',
  };
}

function clarification(question: string, reasonCode: string): IntentResolution {
  const now = Date.now();
  return {
    kind: 'CLARIFICATION',
    confidence: 'MEDIUM',
    reasonCode,
    userMessage: question,
    consumed: true,
    source: 'heuristic',
    actionClass: 'AMBIGUOUS',
    clarification: {
      clarificationId: `clr_${now.toString(16)}`,
      originalRequestId: `req_${now.toString(16)}`,
      question,
      candidateIntents: [],
      expiresAt: now + 10 * 60_000,
    },
  };
}

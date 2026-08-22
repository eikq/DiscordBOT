import { shouldAvoidGenericRefusal } from '../policy/permissionFirst';
import { classifyActionability } from './classify';
import type { ActionabilityClass, IntentKind } from './types';

export const JARVIS_REQUEST_ROUTES = [
  'CONVERSATION',
  'INFORMATION',
  'RESEARCH',
  'WORK',
  'CAPABILITY',
] as const;

export type JarvisRequestRoute = (typeof JARVIS_REQUEST_ROUTES)[number];

export const SOCIAL_ACTIONS = ['IGNORE', 'REACT', 'SPEAK'] as const;
export type SocialAction = (typeof SOCIAL_ACTIONS)[number];

export type RouteDecision = {
  route: JarvisRequestRoute;
  socialAction: SocialAction;
  agentic: boolean;
  reason: string;
  confidence: number;
  forbidden?: boolean;
};

const GREETING = /^(สวัสดี|hello|hi|hey|yo|หวัดดี)(\s|$|[!.])/iu;
const HOW_ARE_YOU = /how are you|เป็นไง|สบายดีไหม|what's up|whats up/iu;
const ACK = /^(ok|okay|thanks|thank you|ครับ|ค่ะ|ได้|รับทราบ|👍+)$/iu;
const EXPLAIN = /อธิบาย|explain|คืออะไร|what is|what's|how does|how do\b/iu;
const RESEARCH = /\bresearch\b|ค้นคว้า|หาข้อมูล|เอกสารล่าสุด|latest .+ (doc|documentation|docs|paper)|look up the latest|official (docs|documentation)/iu;
const WORK = /\binspect\b|\bfix\b|\bimplement\b|\bpatch\b|\brefactor\b|แก้บั[กค]|หาไฟล์แล้วแก้|inspect these files/iu;
const CAPABILITY_MUTATION = /change (this |the )?system setting|ตั้งค่า|toggle|configure|เปิดการตั้งค่า|change .+ setting/iu;
const NOISE = /^[\s\p{P}\p{S}]*$/u;

export function routeJarvisRequest(input: {
  text: string;
  actionability?: ActionabilityClass;
  intentKind?: IntentKind;
}): RouteDecision {
  const text = String(input.text || '').trim();
  if (!text || NOISE.test(text)) {
    return {
      route: 'CONVERSATION',
      socialAction: 'IGNORE',
      agentic: false,
      reason: 'empty_or_noise',
      confidence: 0.99,
    };
  }
  const actionability = input.actionability ?? classifyActionability(text);
  if (input.intentKind === 'FORBIDDEN' || actionability === 'FORBIDDEN') {
    return {
      route: 'CAPABILITY',
      socialAction: 'SPEAK',
      agentic: false,
      reason: 'forbidden',
      confidence: 0.99,
      forbidden: true,
    };
  }
  if (ACK.test(text)) {
    return {
      route: 'CONVERSATION',
      socialAction: 'REACT',
      agentic: false,
      reason: 'acknowledgement',
      confidence: 0.9,
    };
  }
  if ((GREETING.test(text) && text.length < 32) || HOW_ARE_YOU.test(text)) {
    return {
      route: 'CONVERSATION',
      socialAction: 'SPEAK',
      agentic: false,
      reason: 'social_greeting',
      confidence: 0.95,
    };
  }
  if (RESEARCH.test(text)) {
    return {
      route: 'RESEARCH',
      socialAction: 'SPEAK',
      agentic: true,
      reason: 'research_request',
      confidence: 0.86,
    };
  }
  if (WORK.test(text)) {
    return {
      route: 'WORK',
      socialAction: 'SPEAK',
      agentic: true,
      reason: 'work_request',
      confidence: 0.86,
    };
  }
  if (CAPABILITY_MUTATION.test(text)) {
    return {
      route: 'CAPABILITY',
      socialAction: 'SPEAK',
      agentic: true,
      reason: 'capability_mutation',
      confidence: 0.84,
    };
  }
  if (shouldAvoidGenericRefusal(text)) {
    return {
      route: 'CAPABILITY',
      socialAction: 'SPEAK',
      agentic: true,
      reason: 'safe_capability_route',
      confidence: 0.82,
    };
  }
  if (EXPLAIN.test(text)) {
    return {
      route: 'INFORMATION',
      socialAction: 'SPEAK',
      agentic: false,
      reason: 'informational_explain',
      confidence: 0.88,
    };
  }
  if (input.intentKind === 'CAPABILITY') {
    return {
      route: 'CAPABILITY',
      socialAction: 'SPEAK',
      agentic: true,
      reason: 'bound_capability',
      confidence: 0.8,
    };
  }
  if (actionability === 'ACTIONABLE') {
    return {
      route: 'CAPABILITY',
      socialAction: 'SPEAK',
      agentic: true,
      reason: 'actionable',
      confidence: 0.72,
    };
  }
  if (actionability === 'INFORMATION') {
    if (/latest|ล่าสุด|news|ราคา|current/iu.test(text)) {
      return {
        route: 'RESEARCH',
        socialAction: 'SPEAK',
        agentic: true,
        reason: 'current_information',
        confidence: 0.7,
      };
    }
    return {
      route: 'INFORMATION',
      socialAction: 'SPEAK',
      agentic: false,
      reason: 'information',
      confidence: 0.7,
    };
  }
  return {
    route: 'CONVERSATION',
    socialAction: 'SPEAK',
    agentic: false,
    reason: 'default_conversation',
    confidence: 0.6,
  };
}

export function shouldUseWorkAgent(
  route: RouteDecision,
  input: {
    explicitCalls?: boolean;
    intentKind?: IntentKind;
    capabilityId?: string;
  } = {},
): boolean {
  if (input.explicitCalls) return false;
  if (route.forbidden) return false;
  if (input.intentKind === 'FORBIDDEN' || input.intentKind === 'CLARIFICATION' || input.intentKind === 'UNSUPPORTED') {
    return false;
  }
  if (route.route === 'WORK' || route.route === 'RESEARCH') return true;
  return route.route === 'CAPABILITY' && route.agentic && !input.capabilityId;
}

import { classifyActionability, shouldTreatAsForbiddenRequest } from './classify';
import { compactCapabilityCatalog } from './catalog';
import { fastPathResolution, heuristicResolve } from './heuristic';
import { parseSemanticJson } from './semanticLlm';
import { validateIntentResolution } from './schema';
import { resolveOwnerGoal } from '../goals';
import { DESKTOP_PLACE_WINDOW } from '../capabilities/actions/constants';
import { preferConcreteDisplay, type DisplaySelector } from '../desktop/monitorTopology';
import type { CompactCapability, IntentResolution, IntentResolveOptions } from './types';
import { bindDiscourseToIntent, interpretDiscourse, rewriteWrongRoute } from '../conversation';

export async function resolveUserIntent(text: string, options: IntentResolveOptions = {}): Promise<IntentResolution> {
  const catalog = options.catalog ?? compactCapabilityCatalog();
  const actionClass = classifyActionability(text);
  const conversation = options.conversation;

  if (conversation) {
    const discourse = interpretDiscourse(text, conversation);
    const bound = bindDiscourseToIntent(discourse, conversation, text);
    if (bound && (bound.kind !== 'CONVERSATION' || bound.consumed)) {
      return finish(bound, catalog, conversation, text);
    }
  }

  const fast = fastPathResolution(text, {
    catalog,
    applicationIds: options.applicationIds,
    projectIds: options.projectIds,
    aliases: options.aliases,
    context: options.context,
  });
  if (fast) {
    const declared = shouldResolveDeclaredGoal(options)
      ? await resolveDeclaredGoalIntent(text, options)
      : undefined;
    return finish(bindFastPathToGoal(fast, declared) ?? fast, catalog, conversation, text);
  }

  if (shouldTreatAsForbiddenRequest(text)) {
    return finish({
      kind: 'FORBIDDEN',
      confidence: 'HIGH',
      reasonCode: 'FORBIDDEN_REQUEST',
      userMessage: 'ทำรายการนี้ไม่ได้ครับ',
      consumed: true,
      source: 'heuristic',
      actionClass: 'FORBIDDEN',
    }, catalog, conversation, text);
  }

  if (shouldResolveDeclaredGoal(options)) {
    const goalIntent = await resolveDeclaredGoalIntent(text, options);
    if (goalIntent) return finish(goalIntent, catalog, conversation, text);
  }

  const heuristic = heuristicResolve(text, {
    catalog,
    applicationIds: options.applicationIds,
    projectIds: options.projectIds,
    context: options.context,
    aliases: options.aliases,
    now: options.now,
  });
  if (heuristic) return finish(heuristic, catalog, conversation, text);

  if (options.semanticResolve && (actionClass === 'ACTIONABLE' || actionClass === 'INFORMATION' || actionClass === 'AMBIGUOUS')) {
    try {
      const raw = await options.semanticResolve({ text, catalog, context: options.context });
      const parsed = typeof raw === 'string' ? parseSemanticJson(raw) : raw;
      const validated = validateIntentResolution({
        ...(parsed && typeof parsed === 'object' ? parsed : {}),
        source: 'semantic',
        actionClass,
        consumed: true,
      }, catalog);
      if (validated.ok === true) return finish(validated.value, catalog, conversation, text);
      const reasonCode = 'reasonCode' in validated ? validated.reasonCode : 'INVALID_INTENT';
      if (reasonCode === 'UNKNOWN_CAPABILITY') {
        return finish({
          kind: 'UNSUPPORTED',
          confidence: 'HIGH',
          reasonCode: 'UNKNOWN_CAPABILITY',
          userMessage: 'ตอนนี้ผมยังทำรายการนั้นโดยตรงไม่ได้ครับ',
          consumed: true,
          source: 'semantic',
          actionClass,
        }, catalog, conversation, text);
      }
      if (reasonCode === 'FORBIDDEN_ARGUMENT' || reasonCode === 'UNKNOWN_INTENT_FIELD') {
        return finish({
          kind: 'FORBIDDEN',
          confidence: 'HIGH',
          reasonCode,
          userMessage: 'ทำรายการนี้ไม่ได้ครับ',
          consumed: true,
          source: 'semantic',
          actionClass: 'FORBIDDEN',
        }, catalog, conversation, text);
      }
      return finish({
        kind: 'CLARIFICATION',
        confidence: 'LOW',
        reasonCode,
        userMessage: 'ผมยังไม่ชัวร์ว่าต้องการให้ทำอะไร ช่วยระบุอีกครั้งได้ไหมครับ?',
        consumed: true,
        source: 'semantic',
        actionClass: 'AMBIGUOUS',
      }, catalog, conversation, text);
    } catch {
      return finish({
        kind: 'CLARIFICATION',
        confidence: 'LOW',
        reasonCode: 'SEMANTIC_UNAVAILABLE',
        userMessage: 'ผมยังไม่ชัวร์ว่าต้องการให้ทำอะไร ช่วยระบุอีกครั้งได้ไหมครับ?',
        consumed: true,
        source: 'semantic',
        actionClass: 'AMBIGUOUS',
      }, catalog, conversation, text);
    }
  }

  if (actionClass === 'AMBIGUOUS' || actionClass === 'ACTIONABLE' || actionClass === 'INFORMATION') {
    return finish({
      kind: 'CLARIFICATION',
      confidence: 'LOW',
      reasonCode: 'NEEDS_DETAIL',
      userMessage: 'ต้องการให้ช่วยเรื่องอะไรครับ?',
      consumed: true,
      source: 'heuristic',
      actionClass: actionClass === 'INFORMATION' ? 'INFORMATION' : 'AMBIGUOUS',
    }, catalog, conversation, text);
  }

  return finish({
    kind: 'CONVERSATION',
    confidence: 'HIGH',
    reasonCode: 'CONVERSATION',
    consumed: false,
    source: 'heuristic',
    actionClass: 'CONVERSATION',
  }, catalog, conversation, text);
}

function finish(
  resolution: IntentResolution,
  catalog: CompactCapability[],
  conversation: IntentResolveOptions['conversation'],
  text: string,
): IntentResolution {
  const scored = applyConfidencePolicy(resolution, catalog);
  if (!conversation) return scored;
  return rewriteWrongRoute(scored, conversation, text);
}

function bindFastPathToGoal(fast: IntentResolution, declared?: IntentResolution): IntentResolution | undefined {
  if (fast.kind !== 'CAPABILITY' || !fast.capabilityId) return fast;
  if (!declared?.goal) return fast;
  const route = declared.goal.routes.find(item => (
    item.available && item.inputCompatible && item.steps[0]?.capabilityId === fast.capabilityId
  ));
  if (!route) {
    if (
      fast.consumed
      || fast.capabilityId === DESKTOP_PLACE_WINDOW
      || String(fast.reasonCode || '').startsWith('REFERENT_')
      || String(fast.reasonCode || '').startsWith('RESEARCH_')
      || String(fast.reasonCode || '').startsWith('SEMANTIC_')
    ) {
      return { ...fast, goal: declared.goal };
    }
    return declared;
  }
  const goal = structuredClone(declared.goal);
  goal.selectedRouteId = route.id;
  goal.permissionRequired = route.ownerDecisionRequired ? route.steps.map(item => item.capabilityId) : [];
  goal.evidence = [...goal.evidence, `fast-path-bound:${fast.capabilityId}`];
  const adapted = route.steps[0]?.input ?? {};
  const hasAdaptedTarget = Boolean(
    adapted.url || adapted.applicationId || adapted.projectId || adapted.settingsId || adapted.serviceId,
  );
  const base = structuredClone(hasAdaptedTarget ? adapted : (fast.arguments ?? adapted));
  return {
    ...fast,
    arguments: mergeBoundArguments(base, fast.arguments),
    reasonCode: 'DECLARED_GOAL',
    goal,
  };
}

function mergeBoundArguments(
  adapted: Record<string, unknown>,
  fastArgs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged = structuredClone(adapted);
  if (!fastArgs) return merged;
  const display = preferConcreteDisplay(
    isDisplaySelector(fastArgs.display) ? fastArgs.display : null,
    isDisplaySelector(adapted.display) ? adapted.display : null,
  );
  if (display) merged.display = display;
  if (typeof fastArgs.windowHandle === 'string' && !merged.windowHandle) {
    merged.windowHandle = fastArgs.windowHandle;
  }
  return merged;
}

function isDisplaySelector(value: unknown): value is DisplaySelector {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function shouldResolveDeclaredGoal(options: IntentResolveOptions): boolean {
  return Boolean(options.capabilityHost || options.goalCatalog || options.goalSuggestion);
}

async function resolveDeclaredGoalIntent(text: string, options: IntentResolveOptions): Promise<IntentResolution | undefined> {
  const goal = await resolveOwnerGoal(text, {
    host: options.capabilityHost,
    catalog: options.goalCatalog,
    adapters: options.inputAdapters,
    context: options.context,
    suggestion: options.goalSuggestion,
    aliases: options.aliases,
  });
  return intentFromGoal(goal);
}

function intentFromGoal(goal: Awaited<ReturnType<typeof resolveOwnerGoal>>): IntentResolution | undefined {
  if (goal.status === 'NO_MATCH') return undefined;
  if (goal.status === 'RESOLVED' && goal.handler === 'SELF_KNOWLEDGE') {
    return {
      kind: 'CONVERSATION', confidence: confidenceOf(goal.confidence), reasonCode: 'DECLARED_SELF_KNOWLEDGE_GOAL',
      consumed: true, source: 'heuristic', actionClass: 'INFORMATION', goal,
    };
  }
  if (goal.status === 'RESOLVED') {
    const selected = goal.routes.find(route => route.id === goal.selectedRouteId);
    const first = selected?.steps[0];
    if (!first) {
      return {
        kind: 'UNSUPPORTED', confidence: confidenceOf(goal.confidence), reasonCode: 'GOAL_ROUTE_UNAVAILABLE',
        userMessage: 'I do not currently have a verified executable route for that goal.', consumed: true,
        source: 'heuristic', actionClass: 'INFORMATION', goal,
      };
    }
    return {
      kind: 'CAPABILITY', capabilityId: first.capabilityId, arguments: first.input,
      confidence: confidenceOf(goal.confidence), reasonCode: 'DECLARED_GOAL', consumed: true,
      source: 'heuristic', actionClass: selected.risk === 'READ_ONLY' ? 'INFORMATION' : 'ACTIONABLE', goal,
    };
  }
  if (goal.status === 'NEEDS_INPUT' || goal.status === 'CLARIFICATION' || goal.status === 'NEEDS_OWNER_DECISION') {
    return {
      kind: 'CLARIFICATION', confidence: 'LOW', reasonCode: goal.status,
      userMessage: goal.smallestOwnerQuestion || 'I need one more detail before I can continue safely.',
      consumed: true, source: 'heuristic', actionClass: 'AMBIGUOUS', goal,
    };
  }
  return {
    kind: 'UNSUPPORTED', confidence: confidenceOf(goal.confidence), reasonCode: 'GOAL_BLOCKED',
    userMessage: goal.smallestOwnerQuestion || 'I do not currently have a verified route for that goal.',
    consumed: true, source: 'heuristic', actionClass: 'INFORMATION', goal,
  };
}

function confidenceOf(value: number | null): IntentResolution['confidence'] {
  if (value !== null && value >= 0.9) return 'HIGH';
  if (value !== null && value >= 0.78) return 'MEDIUM';
  return 'LOW';
}

export function applyConfidencePolicy(resolution: IntentResolution, catalog: CompactCapability[]): IntentResolution {
  if (resolution.kind !== 'CAPABILITY') return resolution;
  if (!resolution.capabilityId || !catalog.some(item => item.id === resolution.capabilityId)) {
    return {
      ...resolution,
      kind: 'UNSUPPORTED',
      reasonCode: 'UNKNOWN_CAPABILITY',
      userMessage: 'ตอนนี้ผมยังทำรายการนั้นโดยตรงไม่ได้ครับ',
      capabilityId: undefined,
      arguments: undefined,
    };
  }
  if (resolution.confidence === 'LOW') {
    return {
      ...resolution,
      kind: 'CLARIFICATION',
      userMessage: resolution.userMessage || 'ต้องการให้ช่วยเรื่องนี้แบบไหนครับ?',
      actionClass: 'AMBIGUOUS',
    };
  }
  if (resolution.confidence === 'MEDIUM') {
    const mutating = !catalog.find(item => item.id === resolution.capabilityId)?.sideEffectClass
      || catalog.find(item => item.id === resolution.capabilityId)?.sideEffectClass !== 'READ_ONLY';
    if (mutating) {
      return {
        ...resolution,
        kind: 'CLARIFICATION',
        userMessage: resolution.userMessage || 'ให้ผมทำรายการนี้เลยไหมครับ?',
        actionClass: 'AMBIGUOUS',
      };
    }
  }
  return resolution;
}

export function intentStageOf(resolution: IntentResolution): { stage: 'UNDERSTANDING' | 'CLARIFICATION' | 'PERMISSION' | 'ACTION' | 'CONVERSATION'; detail: string } {
  if (resolution.kind === 'CLARIFICATION') return { stage: 'CLARIFICATION', detail: resolution.userMessage || 'waiting for detail' };
  if (resolution.kind === 'FORBIDDEN') return { stage: 'PERMISSION', detail: resolution.reasonCode };
  if (resolution.kind === 'CAPABILITY') {
    const evidence = resolution.contextEvidence
      ? [
        resolution.contextEvidence.contextSource ? `context source: ${resolution.contextEvidence.contextSource}` : '',
        resolution.contextEvidence.resolvedReferent ? `resolved referent: ${resolution.contextEvidence.resolvedReferent}` : '',
        resolution.contextEvidence.aliasSource ? `alias source: ${resolution.contextEvidence.aliasSource}` : '',
        resolution.contextEvidence.resourceAuthority ? `resource authority: ${resolution.contextEvidence.resourceAuthority}` : '',
      ].filter(Boolean).join(' · ')
      : '';
    return { stage: 'ACTION', detail: [resolution.capabilityId || 'capability', evidence].filter(Boolean).join(' — ') };
  }
  if (resolution.kind === 'UNSUPPORTED') return { stage: 'UNDERSTANDING', detail: 'unsupported' };
  return { stage: 'CONVERSATION', detail: 'chat' };
}

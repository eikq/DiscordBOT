import { classifyActionability, shouldTreatAsForbiddenRequest } from './classify';
import { compactCapabilityCatalog } from './catalog';
import { fastPathResolution, heuristicResolve } from './heuristic';
import { parseSemanticJson } from './semanticLlm';
import { validateIntentResolution } from './schema';
import { resolveOwnerGoal } from '../goals';
import type { CompactCapability, IntentResolution, IntentResolveOptions } from './types';

export async function resolveUserIntent(text: string, options: IntentResolveOptions = {}): Promise<IntentResolution> {
  const catalog = options.catalog ?? compactCapabilityCatalog();
  const actionClass = classifyActionability(text);

  const fast = fastPathResolution(text, {
    catalog,
    applicationIds: options.applicationIds,
    projectIds: options.projectIds,
  });
  if (fast) {
    const declared = shouldResolveDeclaredGoal(options)
      ? await resolveDeclaredGoalIntent(text, options)
      : undefined;
    return applyConfidencePolicy(bindFastPathToGoal(fast, declared) ?? fast, catalog);
  }

  if (shouldTreatAsForbiddenRequest(text)) {
    return applyConfidencePolicy({
      kind: 'FORBIDDEN',
      confidence: 'HIGH',
      reasonCode: 'FORBIDDEN_REQUEST',
      userMessage: 'ทำรายการนี้ไม่ได้ครับ',
      consumed: true,
      source: 'heuristic',
      actionClass: 'FORBIDDEN',
    }, catalog);
  }

  if (shouldResolveDeclaredGoal(options)) {
    const goalIntent = await resolveDeclaredGoalIntent(text, options);
    if (goalIntent) return applyConfidencePolicy(goalIntent, catalog);
  }

  const heuristic = heuristicResolve(text, {
    catalog,
    applicationIds: options.applicationIds,
    projectIds: options.projectIds,
    context: options.context,
    now: options.now,
  });
  if (heuristic) return applyConfidencePolicy(heuristic, catalog);

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
      if (validated.ok === true) return applyConfidencePolicy(validated.value, catalog);
      const reasonCode = 'reasonCode' in validated ? validated.reasonCode : 'INVALID_INTENT';
      if (reasonCode === 'UNKNOWN_CAPABILITY') {
        return applyConfidencePolicy({
          kind: 'UNSUPPORTED',
          confidence: 'HIGH',
          reasonCode: 'UNKNOWN_CAPABILITY',
          userMessage: 'ตอนนี้ผมยังทำรายการนั้นโดยตรงไม่ได้ครับ',
          consumed: true,
          source: 'semantic',
          actionClass,
        }, catalog);
      }
      if (reasonCode === 'FORBIDDEN_ARGUMENT' || reasonCode === 'UNKNOWN_INTENT_FIELD') {
        return applyConfidencePolicy({
          kind: 'FORBIDDEN',
          confidence: 'HIGH',
          reasonCode,
          userMessage: 'ทำรายการนี้ไม่ได้ครับ',
          consumed: true,
          source: 'semantic',
          actionClass: 'FORBIDDEN',
        }, catalog);
      }
      return applyConfidencePolicy({
        kind: 'CLARIFICATION',
        confidence: 'LOW',
        reasonCode,
        userMessage: 'ผมยังไม่ชัวร์ว่าต้องการให้ทำอะไร ช่วยระบุอีกครั้งได้ไหมครับ?',
        consumed: true,
        source: 'semantic',
        actionClass: 'AMBIGUOUS',
      }, catalog);
    } catch {
      return applyConfidencePolicy({
        kind: 'CLARIFICATION',
        confidence: 'LOW',
        reasonCode: 'SEMANTIC_UNAVAILABLE',
        userMessage: 'ผมยังไม่ชัวร์ว่าต้องการให้ทำอะไร ช่วยระบุอีกครั้งได้ไหมครับ?',
        consumed: true,
        source: 'semantic',
        actionClass: 'AMBIGUOUS',
      }, catalog);
    }
  }

  if (actionClass === 'AMBIGUOUS' || actionClass === 'ACTIONABLE' || actionClass === 'INFORMATION') {
    return applyConfidencePolicy({
      kind: 'CLARIFICATION',
      confidence: 'LOW',
      reasonCode: 'NEEDS_DETAIL',
      userMessage: 'ต้องการให้ช่วยเรื่องอะไรครับ?',
      consumed: true,
      source: 'heuristic',
      actionClass: actionClass === 'INFORMATION' ? 'INFORMATION' : 'AMBIGUOUS',
    }, catalog);
  }

  return {
    kind: 'CONVERSATION',
    confidence: 'HIGH',
    reasonCode: 'CONVERSATION',
    consumed: false,
    source: 'heuristic',
    actionClass: 'CONVERSATION',
  };
}

function bindFastPathToGoal(fast: IntentResolution, declared?: IntentResolution): IntentResolution | undefined {
  if (!declared?.goal || fast.kind !== 'CAPABILITY' || !fast.capabilityId) return declared;
  const route = declared.goal.routes.find(item => (
    item.available && item.inputCompatible && item.steps[0]?.capabilityId === fast.capabilityId
  ));
  if (!route) return declared;
  const goal = structuredClone(declared.goal);
  goal.selectedRouteId = route.id;
  goal.permissionRequired = route.ownerDecisionRequired ? route.steps.map(item => item.capabilityId) : [];
  goal.evidence = [...goal.evidence, `fast-path-bound:${fast.capabilityId}`];
  return {
    ...fast,
    arguments: structuredClone(route.steps[0]?.input ?? fast.arguments ?? {}),
    reasonCode: 'DECLARED_GOAL',
    goal,
  };
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
  if (resolution.kind === 'CAPABILITY') return { stage: 'ACTION', detail: resolution.capabilityId || 'capability' };
  if (resolution.kind === 'UNSUPPORTED') return { stage: 'UNDERSTANDING', detail: 'unsupported' };
  return { stage: 'CONVERSATION', detail: 'chat' };
}

import type { SelfKnowledgeSnapshot } from '../intelligence/types';
import type { GoalCatalog } from './catalog';
import type { GoalKnowledge } from './types';

export function buildGoalKnowledge(catalog: GoalCatalog, snapshot: Pick<SelfKnowledgeSnapshot, 'generatedAt' | 'capabilities'>): GoalKnowledge[] {
  const capabilities = new Map(snapshot.capabilities.map(item => [item.id, item]));
  return catalog.list().map(definition => {
    if (definition.handler === 'SELF_KNOWLEDGE') {
      return {
        id: definition.id,
        name: definition.name,
        description: definition.description,
        scope: definition.scope,
        maturity: definition.maturity,
        status: 'CAN_DO_NOW' as const,
        reason: 'Structured Self Knowledge is available without model-authored capability claims.',
        capabilityIds: [],
        permissionImplications: definition.permissionImplications,
        verificationExpectation: definition.verificationExpectation,
        evidence: [`goal:${definition.id}`, `self-knowledge:${snapshot.generatedAt}`],
      };
    }
    const routeStates = definition.routes.map(route => ({
      route,
      capabilities: route.steps.map(step => capabilities.get(step.capabilityId)),
    }));
    const ready = routeStates.find(item => item.capabilities.every(capability => capability?.registered && (capability.status === 'AVAILABLE' || capability.status === 'DEGRADED')));
    const partial = routeStates.find(item => item.capabilities.some(capability => capability?.registered && (capability.status === 'AVAILABLE' || capability.status === 'DEGRADED')));
    const capabilityIds = [...new Set(definition.routes.flatMap(route => route.steps.map(step => step.capabilityId)))];
    const status: GoalKnowledge['status'] = definition.maturity === 'PREPARE_CONTRACT'
      ? 'AFTER_SETUP'
      : ready?.route.ownerDecisionRequired
        ? 'NEEDS_APPROVAL'
        : ready
          ? 'CAN_DO_NOW'
          : partial
            ? 'PARTIAL'
            : routeStates.some(item => item.capabilities.some(capability => capability && ['NEEDS_PROVIDER', 'NEEDS_CONFIGURATION', 'NEEDS_DEPENDENCY', 'NEEDS_OWNER_INPUT'].includes(capability.status)))
              ? 'AFTER_SETUP'
              : 'CANNOT_COMPLETE';
    return {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      scope: definition.scope,
      maturity: definition.maturity,
      status,
      reason: status === 'CAN_DO_NOW'
        ? `Declared route ${ready!.route.title} has registered runtime evidence.`
        : status === 'NEEDS_APPROVAL'
          ? `The available route ${ready!.route.title} requires an explicit owner decision.`
          : status === 'PARTIAL'
            ? 'Some declared dependencies are available, but no complete route is ready.'
            : status === 'AFTER_SETUP'
              ? 'A declared route needs provider, configuration, owner input, or local acceptance.'
              : 'No declared route currently has complete registered runtime evidence.',
      capabilityIds,
      permissionImplications: definition.permissionImplications,
      verificationExpectation: definition.verificationExpectation,
      evidence: [`goal:${definition.id}`, `self-knowledge:${snapshot.generatedAt}`, ...capabilityIds.map(id => `capability:${id}`)],
    };
  });
}

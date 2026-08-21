export { GoalCatalog, DEFAULT_GOALS, createDefaultGoalCatalog } from './catalog';
export {
  TrustedInputAdapterRegistry,
  createDefaultInputAdapterRegistry,
  directCapabilityInput,
} from './inputAdapters';
export type {
  AdaptedCapabilityInput,
  TrustedAdapterContext,
  TrustedInputAdapterDefinition,
} from './inputAdapters';
export { resolveOwnerGoal, validateGoalSuggestion } from './resolver';
export type { GoalResolverOptions } from './resolver';
export { buildGoalKnowledge } from './knowledge';
export { validateAdapterAuthorityBoundary, validateAgainstJsonSchema } from './schema';
export type { SchemaValidation } from './schema';
export type {
  GoalDefinition,
  GoalHandlerKind,
  GoalInputDefinition,
  GoalKnowledge,
  GoalKnowledgeStatus,
  GoalMaturity,
  GoalOutcomeEvidence,
  GoalResolution,
  GoalResolutionStatus,
  GoalResolvedRoute,
  GoalResolvedStep,
  GoalRisk,
  GoalRouteDefinition,
  GoalRouteStep,
  GoalScope,
  GoalSuggestion,
  InputCompatibility,
} from './types';

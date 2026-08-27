export { buildSelfKnowledgeSnapshot } from './selfKnowledge';
export type { SelfKnowledgeOptions } from './selfKnowledge';
export { syncAgentRuntimeCapabilities } from './runtimeCapabilitySync';
export type { AgentRuntimeCapabilitySync } from './runtimeCapabilitySync';
export { CapabilityGraph, resolveCapabilityGoal } from './capabilityGraph';
export { CapabilityGapResolver } from './gapResolver';
export type { CapabilityGapResolverInput } from './gapResolver';
export {
  advanceCapabilityCandidate,
  approveCapabilityCandidate,
  CAPABILITY_CANDIDATE_STATES,
  discoverCapabilityCandidate,
  enableCapabilityCandidate,
  markCapabilityCandidateInstalled,
  markCapabilityCandidateRegistered,
} from './acquisition';
export type {
  CapabilityAcquisitionCandidate,
  CapabilityCandidateActor,
  CapabilityCandidateState,
} from './acquisition';
export {
  answerFromSelfKnowledge,
  interpretRequestedCapability,
  resolveSelfKnowledgeGap,
  selfKnowledgeQuestionKind,
} from './answer';
export type { RequestedCapabilityInterpretation, SelfKnowledgeAnswer, SelfKnowledgeAnswerKind } from './answer';
export type {
  CapabilityDependency,
  CapabilityDependencyRelation,
  CapabilityGoalDefinition,
  CapabilityGraphResolution,
  CapabilityIntelligenceStatus,
  DeclaredCapabilityEvidence,
  GapResolutionPath,
  GapResolutionPathKind,
  GapResolutionPlan,
  ObjectiveBlockerCode,
  SelfKnowledgeCapability,
  SelfKnowledgeModel,
  SelfKnowledgeService,
  SelfKnowledgeSnapshot,
} from './types';

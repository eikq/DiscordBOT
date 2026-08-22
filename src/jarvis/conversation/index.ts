export type {
  ConversationDebugView,
  ConversationState,
  ConversationTopicKind,
  ConversationView,
  DiscourseAct,
  DiscourseInterpretation,
  OfferedOption,
  ProjectRecord,
  RecentOperation,
  ReferentSlot,
  ResolvedReferent,
  StatusFocus,
} from './types';
export { DISCOURSE_ACTS, emptyConversationState, isDiscourseAct, REFERENT_SLOTS } from './types';
export { interpretDiscourse, stripOwnerAddress, discoursePreemptsPendingGoal } from './discourse';
export { activeProject, projectByOrdinal, resolvePronounProject, resolveReferent, uniqueSlugOrClarify, restoreProject } from './referents';
export { bindDiscourseToIntent, looksLikeProjectFollowUp, rewriteWrongRoute } from './bind';
export { ConversationStateStore, defaultConversationStatePath } from './store';
export type { ConversationHydration } from './store';
export { applyTurnToConversation } from './update';
export {
  conversationView,
  conversationDebugView,
  optionsFromReply,
  extractComparisonOptions,
  pickRecommendedOption,
  slugFromWorkspacePath,
  compactRecent,
  isOperationalNoise,
  isPermissionPrompt,
  sanitizedRecent,
  compactResearchSpeak,
  compactOwnerSpeak,
} from './view';

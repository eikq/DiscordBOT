export {
  EVIDENCE_ID_PATTERN,
  RESEARCH_CAPABILITY_IDS,
  RESEARCH_COMPARE,
  RESEARCH_CURRENT,
  RESEARCH_FETCH,
  RESEARCH_GET,
  RESEARCH_PRIVATE_BROWSE,
  RESEARCH_SEARCH,
  SESSION_ID_PATTERN,
  SOURCE_ID_PATTERN,
  isPrivateResearchCapabilityId,
  isResearchCapabilityId,
  isResearchReadCapability,
} from './constants';
export {
  PrivateResearchGateway,
  PrivateRouteHealthChecker,
  assertDedicatedChromium,
  detectVBoxManage,
  hasDirectInternetAdapter,
  interpretWebContent,
  planResearchDepth,
  resolveVBoxManage,
  webContentMayInvokeCapability,
  webContentMayReadHostFilesystem,
  webContentMayRequestPrivilege,
} from './private';
export { inferResearchIntent, hasResearchCue } from './researchIntent';
export { registerResearchCapabilities } from './researchCapabilities';
export type { ResearchCapabilityDeps } from './researchCapabilities';
export { ResearchRuntime } from './researchRuntime';
export type { ResearchRuntimeDeps } from './researchRuntime';
export {
  createResearchRuntime,
  resetSharedResearchRuntime,
  sharedResearchRuntime,
  trySharedResearchRuntime,
} from './researchHost';
export { createResearchStore, defaultResearchDbPath, newSessionId, newSourceId } from './researchStore';
export { classifyResearchUrl, assertPublicDestination, canonicalizeUrl, isBlockedIpLiteral } from './networkPolicy';
export { SourceFetcher, nodeResearchGet } from './sourceFetcher';
export { classifySource } from './sourceClass';
export { webpageTextAsData } from './htmlText';
export type {
  EvidenceRecord,
  ResearchResult,
  ResearchSnapshot,
  SourceClass,
  SourceRecord,
} from './types';

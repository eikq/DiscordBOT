export {
  parseDisplaySelector,
  preferConcreteDisplay,
  resolveDisplaySelector,
  sanitizeDisplaySelector,
  summarizeDisplays,
} from './monitorTopology';
export {
  fingerprintDisplay,
  matchDisplayFingerprint,
  parseDisplayFingerprint,
  serializeDisplayFingerprint,
  describeDisplays,
} from './displayIdentity';
export type { DisplayInfo, DisplayRole, DisplaySelector } from './monitorTopology';
export { DEFAULT_ALLOWLISTED_WEB_HOSTS, hostAllowed, urlHost } from './webAllowlist';
export { SessionWebGrantStore } from './sessionWebGrants';
export { planScopedOpen, scopedWebOpenMessage, structuredBlockExplanation } from './scopedOpen';
export type { ScopedOpenInput, ScopedOpenPlan, ScopedResource } from './scopedOpen';
export {
  enumerateWindowsDisplays,
  parseDisplayJson,
  placeAllowlistedWindow,
  buildPlaceWindowScript,
  buildDesktopSnapshotScript,
  buildFocusWindowScript,
  processNameForApplication,
  processNameForUrl,
  processNamesForUrl,
  desktopHostUsesCachedAssembly,
  DESKTOP_HOST_VERSION,
  WindowsDesktopPerception,
} from './windowsDisplayHost';
export {
  parseWindowSnapshot,
  parseWindowSnapshotList,
  diffWindows,
  verifyPlacement,
  nextVerifiedDisplays,
  PLACEMENT_OVERLAP_VERIFIED,
} from './perception';
export type { WindowSnapshot, DesktopPerceptionSnapshot, DesktopPerceptionProvider } from './perception';
export {
  discoverManagedWindow,
  createManagedWindow,
  ManagedWindowStore,
  sharedManagedWindows,
} from './managedWindows';
export type { ManagedWindowRecord } from './managedWindows';
export { observeAfterOpen } from './openVerify';

export {
  DESKTOP_FOCUS_JARVIS_WINDOW,
  DESKTOP_GET_JARVIS_WINDOW,
  DESKTOP_LIST_DISPLAYS,
  DESKTOP_MOVE_JARVIS_WINDOW,
  DESKTOP_PRESENCE_CAPABILITY_IDS,
  DESKTOP_PRESENCE_REASONS,
  DESKTOP_SET_JARVIS_LAYOUT,
  DESKTOP_SET_JARVIS_WINDOW_BOUNDS,
  isDesktopPresenceCapability,
  isDesktopPresenceMutatingCapability,
  isDesktopPresenceReadCapability,
} from './types';
export type {
  ClientWindowReport,
  DesktopHostKind,
  DesktopPresenceReason,
  DisplayInfo,
  DisplaySelector,
  JarvisLayout,
  JarvisWindowInfo,
  ListDisplaysResult,
  NativeJarvisWindowAdapter,
  NativeWindowRole,
  OwnedJarvisWindowRef,
  WindowOpResult,
} from './types';
export { applyOwnerDisplayNames, displayContaining, displayForWindow, loadOwnerDisplayNames, resolveDisplaySelector } from './displayNames';
export { intersectionArea, displayIntersectingBounds } from './geometry';
export { JarvisPresenceStore, parseClientWindowReport, resetSharedJarvisPresenceStore, sharedJarvisPresenceStore } from './presenceStore';
export { JarvisWindowHost, createJarvisWindowHost, enumerateWindowsDisplays, parseDisplayJson } from './windowHost';
export type { JarvisWindowHostOptions } from './windowHost';
export { registerDesktopPresenceCapabilities } from './capabilities';
export { inferDesktopPresenceIntent, parseDisplaySelector } from './intent';
export { NativeOwnershipRegistry, rejectForeignWindowTarget } from './nativeOwnership';
export {
  FORBIDDEN_NATIVE_ARGUMENT_KEYS,
  NATIVE_HELPER_PROTOCOL_VERSION,
  NativeHelperReplayGuard,
  authorizeNativeHelperCommand,
  extractNativeHelperAuth,
  nativeHelperLogSafe,
  parseNativeHelperRequest,
} from './nativeProtocol';
export { FakeNativeJarvisHelper, unavailableNativeHelperHealth } from './nativeHelper';

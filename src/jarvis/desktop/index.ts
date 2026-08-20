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
  WindowOpResult,
} from './types';
export { applyOwnerDisplayNames, displayContaining, loadOwnerDisplayNames, resolveDisplaySelector } from './displayNames';
export { JarvisPresenceStore, parseClientWindowReport, resetSharedJarvisPresenceStore, sharedJarvisPresenceStore } from './presenceStore';
export { JarvisWindowHost, createJarvisWindowHost, enumerateWindowsDisplays, parseDisplayJson } from './windowHost';
export type { JarvisWindowHostOptions, NativeJarvisWindowAdapter } from './windowHost';
export { registerDesktopPresenceCapabilities } from './capabilities';
export { inferDesktopPresenceIntent, parseDisplaySelector } from './intent';

export const DESKTOP_LIST_DISPLAYS = 'desktop.listDisplays';
export const DESKTOP_GET_JARVIS_WINDOW = 'desktop.getJarvisWindow';
export const DESKTOP_MOVE_JARVIS_WINDOW = 'desktop.moveJarvisWindow';
export const DESKTOP_SET_JARVIS_WINDOW_BOUNDS = 'desktop.setJarvisWindowBounds';
export const DESKTOP_FOCUS_JARVIS_WINDOW = 'desktop.focusJarvisWindow';
export const DESKTOP_SET_JARVIS_LAYOUT = 'desktop.setJarvisLayout';

export const DESKTOP_PRESENCE_CAPABILITY_IDS = [
  DESKTOP_LIST_DISPLAYS,
  DESKTOP_GET_JARVIS_WINDOW,
  DESKTOP_MOVE_JARVIS_WINDOW,
  DESKTOP_SET_JARVIS_WINDOW_BOUNDS,
  DESKTOP_FOCUS_JARVIS_WINDOW,
  DESKTOP_SET_JARVIS_LAYOUT,
] as const;

export type DesktopPresenceCapabilityId = (typeof DESKTOP_PRESENCE_CAPABILITY_IDS)[number];

export const DESKTOP_PRESENCE_REASONS = [
  'WINDOW_UNAVAILABLE',
  'DISPLAY_NOT_FOUND',
  'PERMISSION_REQUIRED',
  'UNSUPPORTED_HOST',
  'INVALID_BOUNDS',
  'INVALID_TARGET',
] as const;

export type DesktopPresenceReason = (typeof DESKTOP_PRESENCE_REASONS)[number];

export type DesktopHostKind = 'browser' | 'electron' | 'native-helper' | 'test';

export type DisplayRole = 'primary' | 'current' | 'external' | 'notebook';

export type DisplaySelector = {
  index?: number;
  id?: string;
  name?: string;
  role?: DisplayRole;
};

export type DisplayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DisplayInfo = {
  id: string;
  name: string;
  aliases: string[];
  primary: boolean;
  bounds: DisplayBounds;
  workingArea: DisplayBounds;
  ownerNamed: boolean;
};

export type JarvisWindowState = 'normal' | 'maximized' | 'minimized' | 'fullscreen' | 'unknown';

export type JarvisWindowInfo = {
  available: boolean;
  hostKind: DesktopHostKind;
  bounds?: DisplayBounds;
  displayId?: string;
  displayName?: string;
  state: JarvisWindowState;
  reasonCode?: DesktopPresenceReason;
  source: 'client-report' | 'native' | 'none';
};

export type JarvisLayout = 'maximized' | 'minimized' | 'normal' | 'presenter' | 'restore';

export type WindowOpStatus = 'moved' | 'focused' | 'resized' | 'layout-set' | 'reported' | 'unavailable' | 'failed';

export type WindowOpResult = {
  status: WindowOpStatus;
  reasonCode?: DesktopPresenceReason;
  message: string;
  hostKind: DesktopHostKind;
  window?: JarvisWindowInfo;
  display?: DisplayInfo;
};

export type ListDisplaysResult = {
  status: 'ok' | 'unavailable';
  reasonCode?: DesktopPresenceReason;
  hostKind: DesktopHostKind;
  displays: DisplayInfo[];
  primaryId?: string;
  message: string;
};

export type OwnerDisplayName = {
  id?: string;
  name: string;
  aliases?: string[];
};

export type ClientWindowReport = {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  availWidth?: number;
  availHeight?: number;
  screenWidth?: number;
  screenHeight?: number;
  isMaximized?: boolean;
  reportedAt?: string;
};

export function isDesktopPresenceCapability(id: string): boolean {
  return (DESKTOP_PRESENCE_CAPABILITY_IDS as readonly string[]).includes(id);
}

export function isDesktopPresenceReadCapability(id: string): boolean {
  return id === DESKTOP_LIST_DISPLAYS || id === DESKTOP_GET_JARVIS_WINDOW;
}

export function isDesktopPresenceMutatingCapability(id: string): boolean {
  return isDesktopPresenceCapability(id) && !isDesktopPresenceReadCapability(id);
}

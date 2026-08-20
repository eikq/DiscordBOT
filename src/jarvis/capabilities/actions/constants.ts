import { isReminderReadCapability, REMINDER_CAPABILITY_IDS } from '../../automation/constants';
import {
  DESKTOP_PRESENCE_CAPABILITY_IDS,
  isDesktopPresenceMutatingCapability,
  isDesktopPresenceReadCapability,
} from '../../desktop/types';
import { isResearchReadCapability, RESEARCH_CAPABILITY_IDS } from '../../research/constants';
import { RESEARCH_PRIVATE_BROWSE } from '../../research/private/constants';
import { isWorkspaceReadCapability, WORKSPACE_CAPABILITY_IDS } from '../../workspace/constants';

export {
  REMINDERS_CANCEL,
  REMINDERS_COMPLETE,
  REMINDERS_CREATE,
  REMINDERS_DISMISS,
  REMINDERS_GET,
  REMINDERS_LIST,
  REMINDERS_PAUSE,
  REMINDERS_RESCHEDULE,
  REMINDERS_RESUME,
  REMINDERS_SNOOZE,
  REMINDER_CAPABILITY_IDS,
} from '../../automation/constants';

export const DESKTOP_OPEN_APPLICATION = 'desktop.openApplication';
export const DESKTOP_OPEN_PROJECT = 'desktop.openProject';
export const DESKTOP_OPEN_TRUSTED_URL = 'desktop.openTrustedUrl';
export const DESKTOP_OPEN_SETTINGS = 'desktop.openSettings';
export {
  DESKTOP_FOCUS_JARVIS_WINDOW,
  DESKTOP_GET_JARVIS_WINDOW,
  DESKTOP_LIST_DISPLAYS,
  DESKTOP_MOVE_JARVIS_WINDOW,
  DESKTOP_PRESENCE_CAPABILITY_IDS,
  DESKTOP_SET_JARVIS_LAYOUT,
  DESKTOP_SET_JARVIS_WINDOW_BOUNDS,
} from '../../desktop/types';
export const SYSTEM_STATUS = 'system.status';
export const SYSTEM_BATTERY_STATUS = 'system.batteryStatus';
export const SYSTEM_NETWORK_STATUS = 'system.networkStatus';
export const APPLICATIONS_STATUS = 'applications.status';
export const JARVIS_RUNTIME_STATUS = 'jarvis.runtimeStatus';
export const JARVIS_HEALTH_CHECK = 'jarvis.healthCheck';
export const JARVIS_START_SERVICE = 'jarvis.startService';
export const JARVIS_STOP_SERVICE = 'jarvis.stopService';
export const JARVIS_RESTART_SERVICE = 'jarvis.restartService';

export const GATED_CAPABILITY_IDS = [
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_TRUSTED_URL,
  DESKTOP_OPEN_SETTINGS,
  ...DESKTOP_PRESENCE_CAPABILITY_IDS,
  SYSTEM_STATUS,
  SYSTEM_BATTERY_STATUS,
  SYSTEM_NETWORK_STATUS,
  APPLICATIONS_STATUS,
  JARVIS_RUNTIME_STATUS,
  JARVIS_HEALTH_CHECK,
  JARVIS_START_SERVICE,
  JARVIS_STOP_SERVICE,
  JARVIS_RESTART_SERVICE,
  ...REMINDER_CAPABILITY_IDS,
  ...RESEARCH_CAPABILITY_IDS,
  RESEARCH_PRIVATE_BROWSE,
  ...WORKSPACE_CAPABILITY_IDS,
] as const;

export const CONFIRMATION_TTL_MS = 120_000;
export const SAFE_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u;

export function isGatedCapabilityId(id: string): boolean {
  return (GATED_CAPABILITY_IDS as readonly string[]).includes(id);
}

export function isActionFastPathId(id: string): boolean {
  return isGatedCapabilityId(id);
}

export function isReadOnlyGatedCapability(id: string): boolean {
  return id === SYSTEM_STATUS
    || id === SYSTEM_BATTERY_STATUS
    || id === SYSTEM_NETWORK_STATUS
    || id === APPLICATIONS_STATUS
    || id === JARVIS_RUNTIME_STATUS
    || id === JARVIS_HEALTH_CHECK
    || isReminderReadCapability(id)
    || isResearchReadCapability(id)
    || isWorkspaceReadCapability(id)
    || isDesktopPresenceReadCapability(id);
}

export function isActionGateConfirmCapability(id: string): boolean {
  return id === DESKTOP_OPEN_TRUSTED_URL
    || id === JARVIS_STOP_SERVICE
    || id === JARVIS_RESTART_SERVICE
    || id === RESEARCH_PRIVATE_BROWSE
    || isDesktopPresenceMutatingCapability(id);
}

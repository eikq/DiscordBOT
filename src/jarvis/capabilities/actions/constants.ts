import { isReminderReadCapability, REMINDER_CAPABILITY_IDS } from '../../automation/constants';
import { isResearchReadCapability, RESEARCH_CAPABILITY_IDS } from '../../research/constants';
import { RESEARCH_PRIVATE_BROWSE } from '../../research/private/constants';
import { isWorkspaceReadCapability, WORKSPACE_CAPABILITY_IDS } from '../../workspace/constants';
import { MEDIA_CAPABILITY_IDS, isMediaReadCapability } from '../../media/constants';
import { RECOVERY_SANDBOX_MUTATE, RECOVERY_SANDBOX_ROLLBACK } from '../../recovery/sandboxCapability';
import { SOFTWARE_APPLY_BUILD, SOFTWARE_PLAN_BUILD } from '../../build/constants';
import {
  PROJECT_CAPABILITY_IDS,
  PROJECT_LIST_FILES,
  PROJECT_READ_FILE,
  PROJECT_INSPECT_ARTIFACT,
} from '../../project/constants';

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
export const DESKTOP_OPEN_SCOPED_RESOURCE = 'desktop.openScopedResource';
export const DESKTOP_PLACE_WINDOW = 'desktop.placeWindow';
export const DESKTOP_FOCUS_WINDOW = 'desktop.focusWindow';
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
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_PLACE_WINDOW,
  DESKTOP_FOCUS_WINDOW,
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
  ...MEDIA_CAPABILITY_IDS,
  RECOVERY_SANDBOX_MUTATE,
  RECOVERY_SANDBOX_ROLLBACK,
  SOFTWARE_PLAN_BUILD,
  SOFTWARE_APPLY_BUILD,
  ...PROJECT_CAPABILITY_IDS,
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
    || isMediaReadCapability(id)
    || id === SOFTWARE_PLAN_BUILD
    || id === PROJECT_READ_FILE
    || id === PROJECT_LIST_FILES
    || id === PROJECT_INSPECT_ARTIFACT;
}

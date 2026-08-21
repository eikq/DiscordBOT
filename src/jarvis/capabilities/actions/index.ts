export { ActionAuditLog, defaultActionAuditPath } from './ActionAuditLog';
export { createActionGate, isActionHost } from './ActionGate';
export type { ActionGateOptions, ActionHost } from './ActionGate';
export { ConfirmationStore } from './ConfirmationStore';
export {
  CONFIRMATION_TTL_MS,
  DESKTOP_FOCUS_WINDOW,
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_OPEN_SETTINGS,
  DESKTOP_OPEN_TRUSTED_URL,
  DESKTOP_PLACE_WINDOW,
  GATED_CAPABILITY_IDS,
  JARVIS_HEALTH_CHECK,
  JARVIS_RESTART_SERVICE,
  JARVIS_RUNTIME_STATUS,
  JARVIS_START_SERVICE,
  JARVIS_STOP_SERVICE,
  SYSTEM_BATTERY_STATUS,
  SYSTEM_NETWORK_STATUS,
  SYSTEM_STATUS,
  APPLICATIONS_STATUS,
  REMINDERS_CREATE,
  REMINDERS_LIST,
  isActionFastPathId,
  isGatedCapabilityId,
} from './constants';
export { PermissionPolicy } from './PermissionPolicy';
export { WindowsDesktopActionAdapter } from './WindowsDesktopActionAdapter';
export type { DesktopActionAdapter } from './DesktopActionAdapter';
export {
  applicationById,
  configuredApplicationIds,
  configuredProjectIds,
  loadDesktopAllowlists,
  projectById,
} from './allowlists';
export { blockedActionResult, inferActionIntent, isExplicitActionConfirmation } from './actionIntent';
export { capabilityResultToActionResult, freezeActionResults, pendingConfirmationOf } from './actionResult';
export { registerDesktopCapabilities } from './desktopCapabilities';
export type { SystemStatusPort, SystemStatusSnapshot } from './desktopCapabilities';
export { validateActionInput } from './schema';
export { hashArguments } from './hash';
export { classifyOpenUrl } from './urlSafety';
export {
  JarvisServiceController,
  createJarvisServiceController,
  sharedJarvisServiceController,
  JARVIS_SERVICE_CATALOG,
} from './services';
export { assertLocalMutationRequest, enforceLoopbackBindHost } from '../../standalone/localMutationGuard';
export type {
  ActionAuditEvent,
  ActionExecutionStatus,
  ActionProposal,
  ActionRisk,
  ActionSource,
  ApplicationRecord,
  CapabilityCall,
  DesktopAllowlists,
  DesktopLaunchResult,
  PendingConfirmation,
  PermissionDecision,
  PermissionVerdict,
  ProjectRecord,
} from './types';

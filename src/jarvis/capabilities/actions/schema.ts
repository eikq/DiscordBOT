import {
  MAX_MESSAGE_CHARS,
  MAX_QUERY_CHARS,
  MAX_TITLE_CHARS,
  MAX_WHEN_TEXT_CHARS,
  REMINDER_ID_PATTERN,
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
  SNOOZE_MINUTES,
  isReminderCapabilityId,
} from '../../automation/constants';
import {
  APPLICATIONS_STATUS,
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SETTINGS,
  DESKTOP_OPEN_TRUSTED_URL,
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_PLACE_WINDOW,
  DESKTOP_FOCUS_WINDOW,
  JARVIS_HEALTH_CHECK,
  JARVIS_RESTART_SERVICE,
  JARVIS_RUNTIME_STATUS,
  JARVIS_START_SERVICE,
  JARVIS_STOP_SERVICE,
  SAFE_ID_PATTERN,
  SYSTEM_BATTERY_STATUS,
  SYSTEM_NETWORK_STATUS,
  SYSTEM_STATUS,
} from './constants';
import {
  MAX_QUERY_CHARS as RESEARCH_QUERY_CHARS,
  RESEARCH_COMPARE,
  RESEARCH_CURRENT,
  RESEARCH_FETCH,
  RESEARCH_GET,
  RESEARCH_SEARCH,
  SOURCE_ID_PATTERN,
  isResearchCapabilityId,
} from '../../research/constants';
import { RESEARCH_PRIVATE_BROWSE, isPrivateResearchCapabilityId, isResearchDepth } from '../../research/private/constants';
import { classifyResearchUrl } from '../../research/networkPolicy';
import {
  DOCUMENT_ID_PATTERN,
  MAX_QUERY_CHARS as WORKSPACE_QUERY_CHARS,
  WORKSPACE_COMPARE,
  WORKSPACE_CURRENT,
  WORKSPACE_EXCERPT,
  WORKSPACE_GET,
  WORKSPACE_LIST,
  WORKSPACE_LIST_DOCUMENTS,
  WORKSPACE_META,
  WORKSPACE_REFRESH,
  WORKSPACE_SEARCH,
  WORKSPACE_SYMBOL,
  isWorkspaceCapabilityId,
} from '../../workspace/constants';
import { isJarvisServiceId } from './services/catalog';
import { loadSettingsAllowlist, settingsById } from './settingsAllowlist';
import type { DesktopAllowlists } from './types';
import { classifyOpenUrl } from './urlSafety';
import { RECOVERY_SANDBOX_MUTATE, RECOVERY_SANDBOX_ROLLBACK } from '../../recovery/sandboxCapability';
import { looksLikeSecret } from '../../security/redaction';

export type ValidatedActionInput =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reasonCode: string; userMessage: string };

const FORBIDDEN_KEYS = new Set([
  'command',
  'path',
  'pid',
  'executable',
  'args',
  'argv',
  'processName',
  'uri',
  'port',
  'shell',
  'sql',
  'cron',
  'rrule',
  'action',
  'capability',
  'capabilityId',
  'method',
  'headers',
  'body',
  'cookie',
  'authorization',
  'host',
  'hostname',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(input: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(input).every(key => allowed.includes(key));
}

function rejectForbidden(input: Record<string, unknown>): ValidatedActionInput | undefined {
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_KEYS.has(key)) {
      return { ok: false, reasonCode: 'FORBIDDEN_ARGUMENT', userMessage: 'That argument is not allowed.' };
    }
  }
  return undefined;
}

export function validateActionInput(
  capabilityId: string,
  input: Record<string, unknown>,
  lists: DesktopAllowlists,
): ValidatedActionInput {
  if (!isPlainObject(input)) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Action arguments are invalid.' };
  }
  const forbidden = rejectForbidden(input);
  if (forbidden) return forbidden;

  if (capabilityId === SYSTEM_STATUS || capabilityId === SYSTEM_BATTERY_STATUS || capabilityId === SYSTEM_NETWORK_STATUS || capabilityId === JARVIS_RUNTIME_STATUS) {
    if (!onlyKeys(input, [])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: `${capabilityId} does not accept arguments.` };
    }
    return { ok: true, value: {} };
  }

  if (capabilityId === APPLICATIONS_STATUS) {
    if (!onlyKeys(input, ['applicationId'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only applicationId is allowed.' };
    }
    if (input.applicationId === undefined) return { ok: true, value: {} };
    if (typeof input.applicationId !== 'string' || !SAFE_ID_PATTERN.test(input.applicationId)) {
      return { ok: false, reasonCode: 'INVALID_APPLICATION_ID', userMessage: 'Unknown or invalid application.' };
    }
    return { ok: true, value: { applicationId: input.applicationId } };
  }

  if (capabilityId === DESKTOP_OPEN_APPLICATION) {
    if (!onlyKeys(input, ['applicationId'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only applicationId is allowed.' };
    }
    const applicationId = input.applicationId;
    if (typeof applicationId !== 'string' || !SAFE_ID_PATTERN.test(applicationId)) {
      return { ok: false, reasonCode: 'INVALID_APPLICATION_ID', userMessage: 'Unknown or invalid application.' };
    }
    return { ok: true, value: { applicationId } };
  }

  if (capabilityId === DESKTOP_OPEN_PROJECT) {
    if (!onlyKeys(input, ['projectId'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only projectId is allowed.' };
    }
    const projectId = input.projectId;
    if (typeof projectId !== 'string' || !SAFE_ID_PATTERN.test(projectId)) {
      return { ok: false, reasonCode: 'INVALID_PROJECT_ID', userMessage: 'Unknown or invalid project.' };
    }
    return { ok: true, value: { projectId } };
  }

  if (capabilityId === DESKTOP_OPEN_SETTINGS) {
    if (!onlyKeys(input, ['settingsId'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only settingsId is allowed.' };
    }
    const settingsId = input.settingsId;
    if (typeof settingsId !== 'string' || !SAFE_ID_PATTERN.test(settingsId)) {
      return { ok: false, reasonCode: 'INVALID_SETTINGS_ID', userMessage: 'Unknown or invalid settings page.' };
    }
    if (!settingsById(loadSettingsAllowlist(), settingsId)) {
      return { ok: false, reasonCode: 'UNKNOWN_SETTINGS', userMessage: 'Unknown or invalid settings page.' };
    }
    return { ok: true, value: { settingsId } };
  }

  if (capabilityId === DESKTOP_OPEN_TRUSTED_URL) {
    if (!onlyKeys(input, ['url'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only url is allowed.' };
    }
    if (typeof input.url !== 'string') {
      return { ok: false, reasonCode: 'INVALID_URL', userMessage: 'That URL is not allowed.' };
    }
    const classified = classifyOpenUrl(input.url, lists);
    if (!classified.ok || !classified.normalized) {
      return {
        ok: false,
        reasonCode: classified.reasonCode || 'INVALID_URL',
        userMessage: 'That URL is not allowed.',
      };
    }
    return { ok: true, value: { url: classified.normalized } };
  }

  if (capabilityId === DESKTOP_OPEN_SCOPED_RESOURCE) {
    if (!onlyKeys(input, ['kind', 'applicationId', 'url', 'label', 'display'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only kind, applicationId, url, label, and display are allowed.' };
    }
    const value: Record<string, unknown> = {};
    if (input.kind === 'url' || input.kind === 'application') value.kind = input.kind;
    if (typeof input.applicationId === 'string' && SAFE_ID_PATTERN.test(input.applicationId)) value.applicationId = input.applicationId;
    if (typeof input.label === 'string') value.label = input.label.slice(0, 80);
    if (typeof input.url === 'string') {
      const classified = classifyOpenUrl(input.url, lists);
      if (!classified.ok && classified.reasonCode !== 'EXTERNAL_HTTPS') {
        // confirmable https still has ok:true; blocked schemes fail
      }
      if (!classified.ok) {
        return { ok: false, reasonCode: classified.reasonCode || 'INVALID_URL', userMessage: 'That URL is not allowed.' };
      }
      value.url = classified.normalized;
    }
    if (input.display && typeof input.display === 'object' && !Array.isArray(input.display)) {
      value.display = input.display;
    }
    if (!value.url && !value.applicationId) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'A scoped open needs an application or URL.' };
    }
    return { ok: true, value };
  }

  if (capabilityId === DESKTOP_PLACE_WINDOW) {
    if (!onlyKeys(input, ['kind', 'applicationId', 'url', 'label', 'display'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only kind, applicationId, url, label, and display are allowed.' };
    }
    const value: Record<string, unknown> = {};
    if (input.kind === 'url' || input.kind === 'application') value.kind = input.kind;
    if (typeof input.applicationId === 'string' && SAFE_ID_PATTERN.test(input.applicationId)) {
      value.applicationId = input.applicationId;
    }
    if (typeof input.label === 'string') value.label = input.label.slice(0, 80);
    if (typeof input.url === 'string') {
      const classified = classifyOpenUrl(input.url, lists);
      if (!classified.ok) {
        return { ok: false, reasonCode: classified.reasonCode || 'INVALID_URL', userMessage: 'That URL is not allowed.' };
      }
      value.url = classified.normalized;
    }
    if (input.display && typeof input.display === 'object' && !Array.isArray(input.display)) {
      value.display = input.display;
    }
    if (!value.url && !value.applicationId) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'I need an application or the website window to move.' };
    }
    return { ok: true, value };
  }

  if (capabilityId === DESKTOP_FOCUS_WINDOW) {
    if (!onlyKeys(input, ['applicationId', 'display'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only applicationId and display are allowed.' };
    }
    if (typeof input.applicationId !== 'string' || !SAFE_ID_PATTERN.test(input.applicationId)) {
      return { ok: false, reasonCode: 'INVALID_APPLICATION_ID', userMessage: 'Unknown or invalid application.' };
    }
    const value: Record<string, unknown> = { applicationId: input.applicationId };
    if (input.display && typeof input.display === 'object' && !Array.isArray(input.display)) value.display = input.display;
    return { ok: true, value };
  }

  if (capabilityId === JARVIS_HEALTH_CHECK) {
    if (!onlyKeys(input, ['serviceId'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only serviceId is allowed.' };
    }
    if (input.serviceId === undefined) return { ok: true, value: {} };
    return parseServiceId(input.serviceId);
  }

  if (capabilityId === JARVIS_START_SERVICE || capabilityId === JARVIS_STOP_SERVICE || capabilityId === JARVIS_RESTART_SERVICE) {
    if (!onlyKeys(input, ['serviceId'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only serviceId is allowed.' };
    }
    return parseServiceId(input.serviceId);
  }

  if (isReminderCapabilityId(capabilityId)) {
    return validateReminderInput(capabilityId, input);
  }

  if (isPrivateResearchCapabilityId(capabilityId) || isResearchCapabilityId(capabilityId)) {
    return validateResearchInput(capabilityId, input);
  }

  if (isWorkspaceCapabilityId(capabilityId)) {
    return validateWorkspaceInput(capabilityId, input);
  }

  if (capabilityId === RECOVERY_SANDBOX_MUTATE) {
    if (!onlyKeys(input, ['operationId', 'value'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only operationId and value are allowed.' };
    }
    if (typeof input.operationId !== 'string' || !/^[a-z0-9][a-z0-9_-]{7,63}$/u.test(input.operationId)) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Invalid sandbox operation id.' };
    }
    if (typeof input.value !== 'string' || input.value.length < 1 || input.value.length > 160) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Sandbox value must be 1-160 characters.' };
    }
    if (looksLikeSecret(input.value)) {
      return { ok: false, reasonCode: 'SECRET_INPUT_REJECTED', userMessage: 'Secret-like values are not allowed in the recovery sandbox.' };
    }
    return { ok: true, value: { operationId: input.operationId, value: input.value } };
  }

  if (capabilityId === RECOVERY_SANDBOX_ROLLBACK) {
    if (!onlyKeys(input, ['checkpointId', 'rollbackId'])) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Only checkpointId and rollbackId are allowed.' };
    }
    if (typeof input.checkpointId !== 'string' || !/^checkpoint_[0-9a-f-]{36}$/u.test(input.checkpointId)
      || typeof input.rollbackId !== 'string' || !/^[a-z0-9][a-z0-9_-]{7,63}$/u.test(input.rollbackId)) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Invalid rollback request.' };
    }
    return { ok: true, value: { checkpointId: input.checkpointId, rollbackId: input.rollbackId } };
  }

  return { ok: false, reasonCode: 'UNKNOWN_CAPABILITY', userMessage: 'Unknown capability.' };
}

function parseServiceId(value: unknown): ValidatedActionInput {
  if (typeof value !== 'string' || !SAFE_ID_PATTERN.test(value) || !isJarvisServiceId(value)) {
    return { ok: false, reasonCode: 'UNKNOWN_SERVICE', userMessage: 'Unknown or invalid Jarvis service.' };
  }
  return { ok: true, value: { serviceId: value } };
}

function optionalString(value: unknown, max: number, key: string): string | undefined | ValidatedActionInput {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: `${key} must be text.` };
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: `${key} is too long.` };
  }
  return trimmed;
}

function validateReminderInput(capabilityId: string, input: Record<string, unknown>): ValidatedActionInput {
  const createKeys = ['title', 'message', 'whenText', 'scheduleKind', 'offsetMs', 'localDate', 'localTime', 'weekday', 'days', 'createdFrom', 'deliveryMode'];
  const queryKeys = ['reminderId', 'query', 'status'];
  const ackKeys = ['reminderId', 'occurrenceAt', 'minutes', 'query'];
  const allowed = capabilityId === REMINDERS_CREATE
    ? createKeys
    : capabilityId === REMINDERS_LIST
      ? ['query', 'status']
      : capabilityId === REMINDERS_GET
        ? ['reminderId']
        : capabilityId === REMINDERS_DISMISS
          ? ['reminderId', 'occurrenceAt']
          : capabilityId === REMINDERS_SNOOZE
            ? ackKeys
            : capabilityId === REMINDERS_RESCHEDULE
              ? [...queryKeys, ...createKeys]
              : queryKeys;
  if (!onlyKeys(input, allowed)) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Those reminder arguments are not allowed.' };
  }
  const value: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (key === 'offsetMs' || key === 'weekday' || key === 'minutes') {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: `${key} must be a number.` };
      }
      if (key === 'minutes' && !(SNOOZE_MINUTES as readonly number[]).includes(raw)) {
        return { ok: false, reasonCode: 'INVALID_SNOOZE', userMessage: 'Snooze can be 10, 30, or 60 minutes.' };
      }
      value[key] = raw;
      continue;
    }
    if (key === 'days') {
      if (!Array.isArray(raw) || raw.some(item => typeof item !== 'number')) {
        return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'days must be weekday numbers.' };
      }
      value[key] = raw;
      continue;
    }
    const max = key === 'message'
      ? MAX_MESSAGE_CHARS
      : key === 'whenText'
        ? MAX_WHEN_TEXT_CHARS
        : key === 'title'
          ? MAX_TITLE_CHARS
          : MAX_QUERY_CHARS;
    const parsed = optionalString(raw, max, key);
    if (parsed && typeof parsed === 'object' && 'ok' in parsed) return parsed;
    if (key === 'reminderId' && typeof parsed === 'string' && parsed && !REMINDER_ID_PATTERN.test(parsed)) {
      return { ok: false, reasonCode: 'UNKNOWN_REMINDER', userMessage: 'Unknown reminder.' };
    }
    if (typeof parsed === 'string') value[key] = parsed;
  }
  if (capabilityId === REMINDERS_GET && typeof value.reminderId !== 'string') {
    return { ok: false, reasonCode: 'UNKNOWN_REMINDER', userMessage: 'Unknown reminder.' };
  }
  if ((capabilityId === REMINDERS_CANCEL || capabilityId === REMINDERS_PAUSE || capabilityId === REMINDERS_RESUME || capabilityId === REMINDERS_COMPLETE) && !value.reminderId && !value.query && value.query !== '') {
    // query may be empty when "อันนั้น" refers to the only active reminder
  }
  return { ok: true, value };
}

function validateResearchInput(capabilityId: string, input: Record<string, unknown>): ValidatedActionInput {
  const allowed = capabilityId === RESEARCH_SEARCH
    ? ['query', 'maxResults', 'freshness']
    : capabilityId === RESEARCH_FETCH
      ? ['sourceId', 'url', 'freshness']
      : capabilityId === RESEARCH_GET
        ? ['sourceId']
        : capabilityId === RESEARCH_COMPARE
          ? ['sourceIds']
          : capabilityId === RESEARCH_PRIVATE_BROWSE
            ? ['query', 'url', 'depth']
            : ['query', 'officialOnly', 'freshness', 'compare', 'reuseLast', 'maxResults', 'depth'];
  if (!onlyKeys(input, allowed)) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Those research arguments are not allowed.' };
  }
  const value: Record<string, unknown> = {};
  if (input.query !== undefined) {
    if (typeof input.query !== 'string') {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'query must be text.' };
    }
    const query = input.query.trim();
    if (query.length > RESEARCH_QUERY_CHARS) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'query is too long.' };
    }
    value.query = query;
  }
  if (input.sourceId !== undefined) {
    if (typeof input.sourceId !== 'string' || !SOURCE_ID_PATTERN.test(input.sourceId)) {
      return { ok: false, reasonCode: 'UNKNOWN_SOURCE', userMessage: 'Unknown source.' };
    }
    value.sourceId = input.sourceId;
  }
  if (input.url !== undefined) {
    if (typeof input.url !== 'string') {
      return { ok: false, reasonCode: 'MALFORMED_URL', userMessage: 'That URL is not valid.' };
    }
    const classified = classifyResearchUrl(input.url);
    if (classified.ok === false) {
      return { ok: false, reasonCode: classified.reasonCode, userMessage: classified.userMessage };
    }
    value.url = classified.url.href;
  }
  if (input.sourceIds !== undefined) {
    if (!Array.isArray(input.sourceIds) || input.sourceIds.some(item => typeof item !== 'string' || (item && !SOURCE_ID_PATTERN.test(item)))) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'sourceIds must be source identifiers.' };
    }
    value.sourceIds = input.sourceIds.slice(0, 8);
  }
  if (input.maxResults !== undefined) {
    if (typeof input.maxResults !== 'number' || !Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 8) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'maxResults must be 1-8.' };
    }
    value.maxResults = input.maxResults;
  }
  if (input.freshness !== undefined) {
    if (input.freshness !== 'any' && input.freshness !== 'latest') {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'freshness must be any or latest.' };
    }
    value.freshness = input.freshness;
  }
  for (const flag of ['officialOnly', 'compare', 'reuseLast'] as const) {
    if (input[flag] !== undefined) {
      if (typeof input[flag] !== 'boolean') {
        return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: `${flag} must be boolean.` };
      }
      value[flag] = input[flag];
    }
  }
  if (capabilityId === RESEARCH_GET && typeof value.sourceId !== 'string') {
    return { ok: false, reasonCode: 'UNKNOWN_SOURCE', userMessage: 'Unknown source.' };
  }
  if (capabilityId === RESEARCH_FETCH && !value.sourceId && !value.url) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'sourceId or a public URL is required.' };
  }
  if (input.depth !== undefined) {
    if (!isResearchDepth(input.depth)) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'depth must be quick, standard, deep, or forensic.' };
    }
    value.depth = input.depth;
  }
  if ((capabilityId === RESEARCH_SEARCH || capabilityId === RESEARCH_CURRENT) && !value.query && !value.reuseLast) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'query is required.' };
  }
  if (capabilityId === RESEARCH_PRIVATE_BROWSE && !value.url && !value.query) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'A public URL or query is required for private browse.' };
  }
  return { ok: true, value };
}

function validateWorkspaceInput(capabilityId: string, input: Record<string, unknown>): ValidatedActionInput {
  const allowed = capabilityId === WORKSPACE_LIST
    ? []
    : capabilityId === WORKSPACE_LIST_DOCUMENTS
      ? ['workspaceId', 'query', 'maxResults']
      : capabilityId === WORKSPACE_SEARCH || capabilityId === WORKSPACE_SYMBOL
        ? ['query', 'workspaceId', 'maxResults']
        : capabilityId === WORKSPACE_GET || capabilityId === WORKSPACE_META
          ? ['documentId']
          : capabilityId === WORKSPACE_EXCERPT
            ? ['documentId', 'query']
            : capabilityId === WORKSPACE_COMPARE
              ? ['documentIds', 'leftQuery', 'rightQuery', 'workspaceId']
              : capabilityId === WORKSPACE_REFRESH
                ? ['workspaceId']
                : ['query', 'workspaceId', 'documentId', 'documentIds', 'mode', 'reuseLast', 'hybridWeb', 'maxResults'];
  if (!onlyKeys(input, allowed)) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'Those workspace arguments are not allowed.' };
  }
  const value: Record<string, unknown> = {};
  if (input.workspaceId !== undefined) {
    if (typeof input.workspaceId !== 'string' || !SAFE_ID_PATTERN.test(input.workspaceId)) {
      return { ok: false, reasonCode: 'UNKNOWN_WORKSPACE', userMessage: 'Unknown workspace.' };
    }
    value.workspaceId = input.workspaceId;
  }
  if (input.documentId !== undefined) {
    if (typeof input.documentId !== 'string' || !DOCUMENT_ID_PATTERN.test(input.documentId)) {
      return { ok: false, reasonCode: 'UNKNOWN_DOCUMENT', userMessage: 'Unknown document.' };
    }
    value.documentId = input.documentId;
  }
  if (input.documentIds !== undefined) {
    if (!Array.isArray(input.documentIds) || input.documentIds.some(item => typeof item !== 'string' || !DOCUMENT_ID_PATTERN.test(item))) {
      return { ok: false, reasonCode: 'UNKNOWN_DOCUMENT', userMessage: 'Unknown document.' };
    }
    value.documentIds = input.documentIds.slice(0, 4);
  }
  if (input.query !== undefined) {
    if (typeof input.query !== 'string') {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'query must be text.' };
    }
    const query = input.query.trim();
    if (query.length > WORKSPACE_QUERY_CHARS) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'query is too long.' };
    }
    value.query = query;
  }
  for (const key of ['leftQuery', 'rightQuery'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') {
        return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: `${key} must be text.` };
      }
      const text = input[key].trim();
      if (text.length > WORKSPACE_QUERY_CHARS) {
        return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: `${key} is too long.` };
      }
      value[key] = text;
    }
  }
  if (input.maxResults !== undefined) {
    if (typeof input.maxResults !== 'number' || !Number.isInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > 12) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'maxResults must be 1-12.' };
    }
    value.maxResults = input.maxResults;
  }
  if (input.mode !== undefined) {
    if (!['search', 'symbol', 'summarize', 'compare', 'auto'].includes(String(input.mode))) {
      return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'mode is invalid.' };
    }
    value.mode = input.mode;
  }
  for (const flag of ['reuseLast', 'hybridWeb'] as const) {
    if (input[flag] !== undefined) {
      if (typeof input[flag] !== 'boolean') {
        return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: `${flag} must be boolean.` };
      }
      value[flag] = input[flag];
    }
  }
  if ((capabilityId === WORKSPACE_GET || capabilityId === WORKSPACE_META || capabilityId === WORKSPACE_EXCERPT) && typeof value.documentId !== 'string') {
    return { ok: false, reasonCode: 'UNKNOWN_DOCUMENT', userMessage: 'Unknown document.' };
  }
  if ((capabilityId === WORKSPACE_SEARCH || capabilityId === WORKSPACE_SYMBOL) && !value.query) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'query is required.' };
  }
  if (capabilityId === WORKSPACE_CURRENT && !value.query && !value.reuseLast && !value.documentId && !value.documentIds) {
    return { ok: false, reasonCode: 'INVALID_ARGUMENT', userMessage: 'query or documentId is required.' };
  }
  return { ok: true, value };
}

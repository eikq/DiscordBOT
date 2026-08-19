import { isGatedCapabilityId } from '../capabilities/actions/constants';
import type { CompactCapability, IntentAlternative, IntentConfidence, IntentKind, IntentResolution } from './types';

const KINDS = new Set<IntentKind>(['CAPABILITY', 'CLARIFICATION', 'CONVERSATION', 'UNSUPPORTED', 'FORBIDDEN']);
const CONFIDENCE = new Set<IntentConfidence>(['HIGH', 'MEDIUM', 'LOW']);
const ALLOWED_KEYS = new Set([
  'kind',
  'capabilityId',
  'arguments',
  'confidence',
  'ambiguity',
  'alternatives',
  'reasonCode',
  'userMessage',
  'consumed',
  'source',
  'actionClass',
  'clarification',
]);

const FORBIDDEN_ARG_KEYS = new Set([
  'command',
  'path',
  'pid',
  'executable',
  'args',
  'argv',
  'method',
  'headers',
  'body',
  'cookie',
  'authorization',
  'allow',
  'decision',
  'token',
  'confirmationToken',
  'confirmed',
  'permission',
  'risk',
  'proposalId',
  'shell',
]);

export function validateIntentResolution(
  raw: unknown,
  catalog: CompactCapability[],
): { ok: true; value: IntentResolution } | { ok: false; reasonCode: string; userMessage: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('INVALID_INTENT', 'Intent result must be an object.');
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) return fail('UNKNOWN_INTENT_FIELD', 'Unknown intent field.');
  }
  const kind = record.kind;
  if (typeof kind !== 'string' || !KINDS.has(kind as IntentKind)) {
    return fail('INVALID_INTENT_KIND', 'Unknown intent kind.');
  }
  const confidence = record.confidence;
  if (typeof confidence !== 'string' || !CONFIDENCE.has(confidence as IntentConfidence)) {
    return fail('INVALID_CONFIDENCE', 'Confidence must be HIGH, MEDIUM, or LOW.');
  }
  if (typeof record.reasonCode !== 'string' || !record.reasonCode.trim()) {
    return fail('INVALID_REASON', 'reasonCode is required.');
  }
  if (record.capabilityId !== undefined) {
    if (typeof record.capabilityId !== 'string' || !isGatedCapabilityId(record.capabilityId)) {
      return fail('UNKNOWN_CAPABILITY', 'Capability id is not registered.');
    }
    if (!catalog.some(item => item.id === record.capabilityId)) {
      return fail('UNKNOWN_CAPABILITY', 'Capability id is not in the current catalog.');
    }
  }
  if (kind === 'CAPABILITY' && typeof record.capabilityId !== 'string') {
    return fail('MISSING_CAPABILITY', 'Capability intent needs a catalog id.');
  }
  if (record.arguments !== undefined) {
    const args = validateArguments(record.arguments);
    if (args.ok === false) return args;
  }
  if (record.alternatives !== undefined) {
    if (!Array.isArray(record.alternatives)) return fail('INVALID_ALTERNATIVES', 'alternatives must be an array.');
    for (const item of record.alternatives) {
      if (!item || typeof item !== 'object') return fail('INVALID_ALTERNATIVES', 'Invalid alternative.');
      const alt = item as IntentAlternative;
      if (!isGatedCapabilityId(String(alt.capabilityId || '')) || !catalog.some(entry => entry.id === alt.capabilityId)) {
        return fail('UNKNOWN_CAPABILITY', 'Alternative capability is not registered.');
      }
      if (alt.arguments) {
        const args = validateArguments(alt.arguments);
        if (args.ok === false) return args;
      }
    }
  }
  return { ok: true as const, value: record as IntentResolution };
}

function validateArguments(value: unknown): { ok: true } | { ok: false; reasonCode: string; userMessage: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('INVALID_ARGUMENTS', 'arguments must be an object.');
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_ARG_KEYS.has(key)) {
      return fail('FORBIDDEN_ARGUMENT', 'Those arguments are not allowed.');
    }
  }
  return { ok: true };
}

function fail(reasonCode: string, userMessage: string) {
  return { ok: false as const, reasonCode, userMessage };
}

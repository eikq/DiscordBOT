import type { ActionResult } from '../core/types';
import type { IntentResolution } from './types';

export function clarificationActionResult(resolution: IntentResolution): ActionResult {
  return Object.freeze({
    name: 'intent.clarification',
    status: 'planned' as const,
    capabilityId: 'intent.clarification',
    summary: resolution.userMessage || 'ต้องการรายละเอียดเพิ่มเติมครับ',
    risk: 'READ_ONLY' as const,
    errorCode: resolution.reasonCode,
    detail: resolution.reasonCode,
  });
}

export function conversationActionResult(resolution: IntentResolution): ActionResult {
  return Object.freeze({
    name: 'intent.conversation',
    status: 'completed' as const,
    capabilityId: 'intent.conversation',
    summary: resolution.userMessage || '',
    risk: 'READ_ONLY' as const,
    errorCode: resolution.reasonCode,
    detail: resolution.reasonCode,
  });
}

export function unsupportedActionResult(resolution: IntentResolution): ActionResult {
  const extra = resolution.alternatives?.length
    ? ` ${resolution.alternatives.map(item => item.label).join(' หรือ ')}`
    : '';
  return Object.freeze({
    name: 'intent.unsupported',
    status: 'unavailable' as const,
    capabilityId: 'intent.unsupported',
    summary: `${resolution.userMessage || 'ตอนนี้ผมยังทำรายการนั้นโดยตรงไม่ได้ครับ'}${extra}`.trim(),
    risk: 'READ_ONLY' as const,
    errorCode: resolution.reasonCode,
    detail: resolution.reasonCode,
  });
}

export function isUnavailableAction(result: { status?: string; errorCode?: string } | undefined): boolean {
  if (!result) return false;
  return result.status === 'unavailable'
    || result.errorCode === 'NOT_INSTALLED'
    || result.errorCode === 'UNAVAILABLE';
}

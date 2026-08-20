import { randomBytes } from 'node:crypto';
import type { JarvisTraceRecord } from './traceTypes';

/**
 * Cross-layer request correlation. Ids are opaque strings, not Discord types.
 * turnId may equal requestId when a typed ask is a single turn; they stay
 * independent fields so speech/mic turns can differ from Core request ids.
 */
export type JarvisCorrelationIds = {
  sessionId: string;
  requestId: string;
  turnId: string;
  taskId?: string;
  stepId?: string;
  traceId?: string;
  presentationId?: string;
};

export type CorrelationIssue =
  | 'missing_sessionId'
  | 'missing_requestId'
  | 'missing_turnId'
  | 'stepId_without_taskId'
  | 'empty_optional';

function mint(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

function optional(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function createCorrelationIds(input: Partial<JarvisCorrelationIds> = {}): JarvisCorrelationIds {
  const sessionId = input.sessionId?.trim() || 'standalone';
  const requestId = input.requestId?.trim() || mint('req');
  const turnId = input.turnId?.trim() || mint('turn');
  return {
    sessionId,
    requestId,
    turnId,
    ...(optional(input.taskId) ? { taskId: optional(input.taskId) } : {}),
    ...(optional(input.stepId) ? { stepId: optional(input.stepId) } : {}),
    ...(optional(input.traceId) ? { traceId: optional(input.traceId) } : {}),
    ...(optional(input.presentationId) ? { presentationId: optional(input.presentationId) } : {}),
  };
}

export function extendCorrelation(
  base: JarvisCorrelationIds,
  extra: Partial<Pick<JarvisCorrelationIds, 'taskId' | 'stepId' | 'traceId' | 'presentationId'>> = {},
): JarvisCorrelationIds {
  return createCorrelationIds({ ...base, ...extra });
}

export function correlationIssues(ids: JarvisCorrelationIds): CorrelationIssue[] {
  const issues: CorrelationIssue[] = [];
  if (!ids.sessionId.trim()) issues.push('missing_sessionId');
  if (!ids.requestId.trim()) issues.push('missing_requestId');
  if (!ids.turnId.trim()) issues.push('missing_turnId');
  if (ids.stepId?.trim() && !ids.taskId?.trim()) issues.push('stepId_without_taskId');
  for (const value of [ids.taskId, ids.stepId, ids.traceId, ids.presentationId]) {
    if (value !== undefined && !value.trim()) issues.push('empty_optional');
  }
  return issues;
}

export function correlationIsCoherent(ids: JarvisCorrelationIds): boolean {
  return correlationIssues(ids).length === 0;
}

export function toTraceCorrelation(ids: JarvisCorrelationIds): Pick<
  JarvisTraceRecord,
  'sessionId' | 'requestId' | 'turnId' | 'taskId' | 'stepId' | 'presentationId'
> & { id?: string } {
  return {
    sessionId: ids.sessionId,
    requestId: ids.requestId,
    turnId: ids.turnId,
    ...(ids.taskId ? { taskId: ids.taskId } : {}),
    ...(ids.stepId ? { stepId: ids.stepId } : {}),
    ...(ids.presentationId ? { presentationId: ids.presentationId } : {}),
    ...(ids.traceId ? { id: ids.traceId } : {}),
  };
}

import type { VerifiedFact } from '../core/types';
import type { WorkspaceResult } from './types';

export function workspaceFactsFromResult(result: WorkspaceResult): VerifiedFact[] {
  return result.citations.map(citation => ({
    key: `document.${citation.documentId}`,
    value: citation.label,
    sourceType: 'tool',
    sourceRef: citation.documentId,
    confidence: 1,
    immutableForPresentation: true,
  }));
}

export function isWorkspaceResult(value: unknown): value is WorkspaceResult {
  return Boolean(value)
    && typeof value === 'object'
    && Array.isArray((value as WorkspaceResult).documentRefs)
    && Array.isArray((value as WorkspaceResult).citations)
    && Array.isArray((value as WorkspaceResult).documents);
}

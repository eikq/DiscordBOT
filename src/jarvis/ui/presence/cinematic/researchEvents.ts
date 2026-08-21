/**
 * Map existing operation-bus events onto Presence research stages.
 * Does not invent a second event vocabulary on the bus.
 */

export type ResearchVisualStage =
  | 'RESEARCH_STARTED'
  | 'SOURCE_DISCOVERED'
  | 'SOURCE_FETCH_STARTED'
  | 'SOURCE_RECEIVED'
  | 'SOURCE_CLASSIFIED'
  | 'EVIDENCE_UPDATED'
  | 'CONFLICT_UPDATED'
  | 'SYNTHESIS_STARTED'
  | 'RESEARCH_VERIFICATION_STARTED'
  | 'RESEARCH_COMPLETED'
  | 'RESEARCH_FAILED';

const RESEARCH_TYPES = new Set([
  'SEARCH',
  'SOURCE',
  'NAVIGATE',
  'EVIDENCE',
  'COMPARE',
  'VERIFY',
  'PROGRESS',
  'TASK_RECEIVED',
  'TASK_STEP',
  'TASK_COMPLETED',
  'TASK_FAILED',
  'ERROR',
]);

export function isResearchOperationType(type: string): boolean {
  return RESEARCH_TYPES.has(type);
}

export function researchStageFromEvent(event: {
  type: string;
  visualState?: string;
  level?: string;
  payload?: Record<string, unknown>;
  summary?: string;
}): ResearchVisualStage | null {
  const visual = event.visualState ?? '';
  const researchVisual = /WEB_SEARCH|FETCHING|COMPARING|PRIVATE_RESEARCH|WORKSPACE_SEARCH/.test(visual);
  const text = `${event.summary ?? ''} ${JSON.stringify(event.payload ?? {})}`.toLowerCase();
  const researchText = /research|source|qwen|web search|ค้น/.test(text);

  if ((event.type === 'ERROR' || event.type === 'TASK_FAILED') && (researchVisual || researchText)) {
    return 'RESEARCH_FAILED';
  }

  switch (event.type) {
    case 'SEARCH':
      return 'RESEARCH_STARTED';
    case 'SOURCE':
      return event.payload?.status === 'listed' ? 'SOURCE_DISCOVERED' : 'SOURCE_RECEIVED';
    case 'NAVIGATE':
      return 'SOURCE_FETCH_STARTED';
    case 'EVIDENCE':
      return 'EVIDENCE_UPDATED';
    case 'COMPARE':
      return /conflict|disagree/.test(text) ? 'CONFLICT_UPDATED' : 'SYNTHESIS_STARTED';
    case 'VERIFY':
      return researchVisual || researchText ? 'RESEARCH_VERIFICATION_STARTED' : null;
    case 'TASK_COMPLETED':
      return researchVisual || researchText ? 'RESEARCH_COMPLETED' : null;
    case 'TASK_FAILED':
    case 'ERROR':
      return researchVisual || researchText ? 'RESEARCH_FAILED' : null;
    case 'TASK_RECEIVED':
    case 'TASK_STEP':
    case 'PROGRESS':
      return researchVisual || researchText ? 'RESEARCH_STARTED' : null;
    default:
      return researchVisual ? 'RESEARCH_STARTED' : null;
  }
}

export function researchLiveFromStage(stage: ResearchVisualStage | null): boolean {
  if (!stage) return false;
  return stage !== 'RESEARCH_COMPLETED' && stage !== 'RESEARCH_FAILED';
}

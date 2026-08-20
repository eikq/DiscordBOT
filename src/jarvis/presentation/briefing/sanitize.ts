import { redactDeep, redactSecrets } from '../../security/redaction';
import { FORBIDDEN_PRESENTATION_KEYS, type PlannedPresentation, type PresentationModel } from './types';

const FORBIDDEN = new Set<string>(FORBIDDEN_PRESENTATION_KEYS);

export function sanitizePresentationText(value: string): string {
  return redactSecrets(value).replace(/\s+/gu, ' ').trim();
}

export function stripForbiddenPresentationKeys<T>(value: T, depth = 0): T {
  if (depth > 8 || value == null) return value;
  if (Array.isArray(value)) {
    return value.map(item => stripForbiddenPresentationKeys(item, depth + 1)) as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN.has(key)) continue;
      out[key] = stripForbiddenPresentationKeys(item, depth + 1);
    }
    return out as T;
  }
  return value;
}

export function sanitizePlannedPresentation(planned: PlannedPresentation): PlannedPresentation {
  if (planned.density === 'plain') return planned;
  const cleaned = stripForbiddenPresentationKeys(planned);
  const redacted = redactDeep(cleaned) as PresentationModel;
  return {
    ...redacted,
    title: sanitizePresentationText(redacted.title),
    subtitle: redacted.subtitle ? sanitizePresentationText(redacted.subtitle) : undefined,
    summary: sanitizePresentationText(redacted.summary),
    spokenSummary: sanitizePresentationText(redacted.spokenSummary),
    sections: redacted.sections.map(section => ({
      ...section,
      title: sanitizePresentationText(section.title),
      body: sanitizePresentationText(section.body),
    })),
    cards: redacted.cards.map(card => ({
      ...card,
      title: sanitizePresentationText(card.title),
      body: sanitizePresentationText(card.body),
    })),
    evidence: redacted.evidence.map(item => ({
      ...item,
      label: sanitizePresentationText(item.label),
      note: item.note ? sanitizePresentationText(item.note) : undefined,
    })),
    limitations: redacted.limitations.map(sanitizePresentationText),
    recommendedActions: redacted.recommendedActions.map(sanitizePresentationText),
    narrationSegments: redacted.narrationSegments.map(segment => ({
      ...segment,
      text: sanitizePresentationText(segment.text),
    })),
    playback: redacted.playback
      ? {
        ...redacted.playback,
        presentationId: sanitizePresentationText(redacted.playback.presentationId),
        segmentId: sanitizePresentationText(redacted.playback.segmentId),
        targetId: sanitizePresentationText(redacted.playback.targetId),
      }
      : redacted.playback,
  };
}

export function presentationHasForbiddenKeys(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  return Object.keys(value as Record<string, unknown>).some(key => FORBIDDEN.has(key));
}

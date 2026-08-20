import type { JarvisOperationEvent } from '../security/types';

export function formatSseEvent(event: JarvisOperationEvent): string {
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function formatSseComment(text: string): string {
  return `: ${text}\n\n`;
}

export function parseLastEventId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

export function sseCursorFrom(queryAfter: unknown, lastEventIdHeader: unknown): number | undefined {
  return parseLastEventId(queryAfter) ?? parseLastEventId(lastEventIdHeader);
}

export function writeSseReplay(events: JarvisOperationEvent[], write: (chunk: string) => void): void {
  for (const event of events) write(formatSseEvent(event));
}

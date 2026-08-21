/**
 * Shape spoken text for more natural TTS without inventing facts.
 */

const ABBREV = /\b(Dr|Mr|Mrs|Ms|vs|etc|Inc|Ltd)\.$/u;

export function shapeSpokenText(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return '';
  const sentences = splitSentences(trimmed).map(sentence => {
    let next = sentence.trim();
    next = next.replace(/\bCapability invoked successfully\.?/iu, '');
    next = next.replace(/\b(OK|Ok)\b/g, 'Okay');
    if (next && !/[.!?…]$/u.test(next) && !ABBREV.test(next)) next = `${next}.`;
    return next;
  }).filter(Boolean);
  return sentences.join(' ').replace(/\s+/g, ' ').trim();
}

export function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const char of text) {
    current += char;
    if (/[.!?…]/.test(char) && current.trim().length > 1) {
      parts.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function chunkSpokenText(text: string, maxChars = 220): string[] {
  const shaped = shapeSpokenText(text);
  if (shaped.length <= maxChars) return shaped ? [shaped] : [];
  const sentences = splitSentences(shaped);
  const chunks: string[] = [];
  let buffer = '';
  for (const sentence of sentences) {
    if ((buffer + ' ' + sentence).trim().length > maxChars && buffer) {
      chunks.push(buffer.trim());
      buffer = sentence;
    } else {
      buffer = `${buffer} ${sentence}`.trim();
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}

export function isDuplicateUtterance(previous: string | undefined, next: string): boolean {
  if (!previous) return false;
  return normalizeSpoken(previous) === normalizeSpoken(next);
}

function normalizeSpoken(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

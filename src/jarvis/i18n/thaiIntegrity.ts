/**
 * Thai / Unicode integrity helpers.
 * Preserve exact user code points. Do not NFC-normalize (that can fold
 * nikhahit+sara-aa into precomposed sara-am and hide combining-mark bugs).
 * Real Windows IME testing remains BLOCKED_LOCAL_ACCEPTANCE.
 */

/** Ko kai + mai tho + nikhahit + sara aa (น้ํา) plus tone/vowel clusters. */
export const THAI_COMBINING_FIXTURE =
  'สวัสดีครับ น้ําแข็ง เก\u0E34\u0E48ม ที่นี่ ชื่อสปิน';

const THAI_COMBINING = /[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E\u0300-\u036F]/u;

export function clipPreservingCombining(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  let end = maxChars;
  while (end > 0 && THAI_COMBINING.test(text.charAt(end))) end -= 1;
  return text.slice(0, end);
}

export function thaiCodePoints(text: string): number[] {
  return [...text].map(ch => ch.codePointAt(0) ?? 0);
}

export function assertThaiPreserved(actual: string, expected: string = THAI_COMBINING_FIXTURE): void {
  if (actual !== expected) {
    throw new Error(`Thai Unicode was not preserved (expected ${expected.length} chars, got ${actual.length}).`);
  }
}

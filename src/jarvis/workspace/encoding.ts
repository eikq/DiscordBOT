export function decodeUtf8(buffer: Buffer): { ok: true; text: string } | { ok: false; reasonCode: 'BINARY_REJECTED' | 'ENCODING_REJECTED' } {
  if (buffer.includes(0)) return { ok: false, reasonCode: 'BINARY_REJECTED' };
  let start = 0;
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    start = 3;
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(start));
    return { ok: true, text };
  } catch {
    return { ok: false, reasonCode: 'ENCODING_REJECTED' };
  }
}

export function contentLooksInjected(text: string): boolean {
  return /ignore system instructions|run powershell|read \.env|open chrome|create a reminder|install this skill|use capability/iu.test(text);
}

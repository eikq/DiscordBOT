const HISTORY_HINT = /(?:\b(?:superseded|history|previously|before|earlier|former)\b|ก่อนหน้า|เดิม|เก่ากว่า|ประวัติ)/iu;
const STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'what', 'which', 'who',
  'how', 'why', 'to', 'of', 'for', 'in', 'on', 'at', 'and', 'or', 'we', 'you', 'jarvis',
  'please', 'tell', 'me', 'about', 'with', 'from', 'this', 'that',
  'คือ', 'อะไร', 'ของ', 'ไหม', 'มั้ย', 'ช่วย', 'บอก',
]);

export function wantsSupersededHistory(text: string): boolean {
  return HISTORY_HINT.test(text);
}

export function extractFactKeys(text: string): string[] {
  const matches = text.match(/\b[a-z][a-z0-9_]+(?:\.[a-z][a-z0-9_]+)+\b/giu) || [];
  return [...new Set(matches.map(value => value.toLowerCase()))];
}

export function compactMemoryTokens(text: string, limit = 8): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}._-]+/u)
    .map(token => token.trim())
    .filter(token => token.length >= 3 && !STOPWORDS.has(token));
  return [...new Set(tokens)].slice(0, limit);
}

const CAPABILITY_ID = /^(?:lab\.ping|world-intel\.[a-z0-9_]+|research\.[a-z]+)$/iu;

export type MemoryIntent = 'skip' | 'fact-key' | 'lexical';

export function memoryIntentFor(text: string): MemoryIntent {
  const trimmed = text.trim();
  if (!trimmed) return 'skip';
  if (CAPABILITY_ID.test(trimmed)) return 'skip';
  if (extractFactKeys(trimmed).length > 0) return 'fact-key';
  if (/\d+\s*[+\-*/]\s*\d+/u.test(trimmed) && compactMemoryTokens(trimmed).length <= 8) {
    return 'skip';
  }
  return 'lexical';
}

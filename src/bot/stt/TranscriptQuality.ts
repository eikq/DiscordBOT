const PROMPT_ECHO_TERMS = [
  'move speed', 'movespeed', 'movement speed', 'attack speed', 'cooldown', 'damage', 'item', 'build',
];

export function transcriptHallucinationReason(
  normalizedText: string,
  options: { rawText?: string; durationSeconds?: number } = {},
): string | null {
  const cleaned = clean(normalizedText);
  if (!cleaned) return null;
  const promptTermCount = PROMPT_ECHO_TERMS.filter(term => cleaned.includes(term)).length;
  if (promptTermCount >= 3) return 'keyword_prompt_echo';

  const isolatedPromptTerm = /^(?:move speed|movespeed|movement speed|attack speed)$/u.test(cleaned);
  if (isolatedPromptTerm && (options.durationSeconds === undefined || options.durationSeconds < 3)) {
    return 'isolated_prompt_term';
  }
  if (/^move speed(?:\s+(?:มอเตอร์สปีด|มอฟสปีด|มอฟมันสปีด|มอฟมิสปีด|มอฟเวิสปีด)){1,}$/u.test(cleaned)) {
    return 'repeated_prompt_term';
  }

  const rawCleaned = clean(options.rawText || normalizedText);
  if (cleaned === 'move speed' && rawCleaned !== 'move speed' && rawCleaned.split(' ').length <= 2) {
    return 'isolated_dictionary_correction';
  }
  return null;
}

function clean(value: string): string {
  return String(value || '')
    .toLocaleLowerCase()
    .replace(/[.,!?;:]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

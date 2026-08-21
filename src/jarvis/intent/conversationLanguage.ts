export type ConversationLanguage = 'th' | 'en' | 'mixed';

export function detectConversationLanguage(text: string): ConversationLanguage {
  const thai = /[\u0E00-\u0E7F]/.test(text);
  const latin = /[A-Za-z]/.test(text);
  if (thai && latin) return 'mixed';
  if (thai) return 'th';
  return 'en';
}

export function preferredLanguage(
  text: string,
  stored?: string | null,
): 'th' | 'en' {
  if (stored === 'th' || stored === 'en') return stored;
  const detected = detectConversationLanguage(text);
  return detected === 'th' || detected === 'mixed' ? 'th' : 'en';
}

export function speakInLanguage(
  language: 'th' | 'en',
  copy: { th: string; en: string },
): string {
  return language === 'th' ? copy.th : copy.en;
}

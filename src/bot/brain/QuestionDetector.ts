/**
 * Detect conversational Thai/English questions that are commonly spoken
 * without a question mark in Discord voice chat.
 */
export function looksLikeConversationalQuestion(text: string): boolean {
  const normalized = text.toLowerCase().replace(/\s+/gu, ' ').trim();
  if (!normalized) return false;
  if (/[?？]\s*$/u.test(normalized)) return true;

  const spoken = normalized.replace(/[.!…。]+$/gu, '').trim();

  // Thai yes/no and status questions are normally spoken without punctuation.
  // Require something before a bare "ยัง" so the one-word answer "ยัง" is not
  // mistaken for a new question.
  if (/(?:ไหม|มั้ย|ปะ|ป่ะ|รึเปล่า|หรือเปล่า|เหรอ|หรอ|หรือยัง)(?:นะ|อะ|อ่ะ|วะ|ว่ะ|ครับ|คะ|ค่ะ|เว้ย|หน่อย)?$/u.test(spoken)) {
    return true;
  }
  if (spoken.length > 3 && /ยัง(?:นะ|อะ|อ่ะ|วะ|ว่ะ|ครับ|คะ|ค่ะ|เว้ย)?$/u.test(spoken)) {
    return true;
  }

  // Open questions and compressed Discord speech such as "ทำไรอยู่".
  if (/(?:ใคร|อะไร|ที่ไหน|อยู่ไหน|เมื่อไหร่|ทำไม|ยังไง|เท่าไหร่|กี่(?:โมง|คน|อัน|รอบ)?|ทำ(?:อะไร|ไร)(?:อยู่)?|เล่น(?:อะไร|ไร)|กิน(?:อะไร|ไร)|เอาไง|ว่าไง)/u.test(spoken)) {
    return true;
  }

  return /^(?:who|what|where|when|why|how|do|does|did|is|are|am|can|could|would|should|have|has)\b/iu.test(spoken);
}

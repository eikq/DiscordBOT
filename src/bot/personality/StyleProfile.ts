export interface StyleProfile {
    averageResponseLength: string;
    thaiEnglishMixingFrequency: string;
    profanityFrequency: string;
    commonParticles: string[];
    commonPhrases: string[];
    typicalGreeting: string;
    typicalDisagreementPattern: string;
}

// Hardcoded for Phase 3 (Owner Profile)
export const DEFAULT_STYLE_PROFILE: StyleProfile = {
    averageResponseLength: "Very short, usually 1-3 words",
    thaiEnglishMixingFrequency: "High (uses 'valo', 'minecraft', 'wait', 'discord' naturally)",
    profanityFrequency: "Medium (uses กู, มึง, แม่ง, เชี่ย, สัส, ควย casually with close friends)",
    commonParticles: ["ปะ", "ละ", "ดิ", "วะ", "ว่ะ", "อะ", "เว้ย"],
    commonPhrases: ["ขก.", "ขก.อะ", "ไม่เอาอะ", "เอาดิ", "จริงดิ", "เดี๋ยวกูมา", "เออ"],
    typicalGreeting: "โย่ว",
    typicalDisagreementPattern: "Casually dismissive (e.g. 'ไม่เอาอะ', 'ขก.')"
};

import type { ActionIntent } from '../capabilities/actions/actionIntent';
import { SERVICE_ALIASES } from '../capabilities/actions/services/catalog';
import { RESEARCH_COMPARE, RESEARCH_CURRENT } from './constants';

const THAI_RESEARCH_CUES = [
  'หาข่าว',
  'ค้นข่าว',
  'ค้นข้อมูล',
  'หาข้อมูล',
  'หาแหล่ง',
  'เทียบข้อมูล',
  'แหล่งต้นฉบับ',
  'แหล่งข้อมูลทางการ',
  'เว็บทางการ',
  'ข้อมูลล่าสุด',
  'มีข่าวอะไร',
  'ข่าวอะไรเกี่ยวกับ',
  'ล่าสุดเมื่อไร',
  'ล่าสุดเมื่อไหร่',
  'เก่าแค่ไหน',
  'เช็คราคา',
  'เช็กราคา',
  'ดูข่าว',
  'ช่วยหา',
  'หาอะไรเกี่ยวกับ',
  'ลองดูว่า',
  'ข่าวล่าสุด',
];

const ENGLISH_RESEARCH_CUES = [
  'find the latest',
  'search the web',
  'compare sources',
  'compare multiple sources',
  'primary source',
  'official documentation',
  'how recent',
  'research this',
  'look up',
  'look into',
  'find out',
  'latest news',
  'check prices',
];

const SCHEDULED_CUES = [
  'ทุกชั่วโมง',
  'ทุกเช้า',
  'ทุกวัน',
  'every hour',
  'every morning',
  'unattended',
  'monitor this site',
  'search this website every',
];

export function inferResearchIntent(text: string): ActionIntent {
  const raw = text.trim();
  if (!raw) return { kind: 'none' };
  if (!hasResearchCue(raw) && !hasResearchTopicCue(raw)) return { kind: 'none' };
  if (isServiceStatusWithoutTopic(raw)) return { kind: 'none' };

  if (SCHEDULED_CUES.some(cue => includesCue(raw, cue))) {
    return {
      kind: 'blocked',
      reasonCode: 'SCHEDULED_RESEARCH_UNSUPPORTED',
      userMessage: 'I can research when you ask. I cannot search the web on a schedule.',
    };
  }

  const officialOnly = isOfficialOnly(raw);
  const freshness = wantsLatest(raw) ? 'latest' as const : 'any' as const;
  const compare = isCompare(raw);
  const query = extractTopic(raw);
  const reuseLast = isFreshnessFollowUp(raw) && isThinTopic(query);

  if (compare && (reuseLast || !query || isThinTopic(query))) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{ id: RESEARCH_COMPARE, input: { sourceIds: [] } }],
    };
  }

  if ((!query || isThinTopic(query)) && !reuseLast) {
    return { kind: 'none' };
  }

  return {
    kind: 'action',
    consumed: true,
    calls: [{
      id: RESEARCH_CURRENT,
      input: {
        query: query || raw,
        officialOnly,
        freshness,
        compare,
        reuseLast,
      },
    }],
  };
}

export function hasResearchCue(text: string): boolean {
  return THAI_RESEARCH_CUES.some(cue => includesCue(text, cue))
    || ENGLISH_RESEARCH_CUES.some(cue => includesCue(text, cue))
    || hasResearchTopicCue(text);
}

function hasResearchTopicCue(text: string): boolean {
  return /(ข่าว|ราคา|price|news).{0,32}(ล่าสุด|วันนี้|rtx|nvidia|5090)|(rtx|nvidia|5090).{0,32}(ราคา|ข่าว|ล่าสุด|price|news)/iu.test(text);
}

function isServiceStatusWithoutTopic(text: string): boolean {
  if (hasResearchTopicCue(text) || /ราคา|ข่าว|price|news|rtx|nvidia/iu.test(text)) return false;
  const lowered = text.toLocaleLowerCase();
  const service = Object.keys(SERVICE_ALIASES).some(alias => {
    if (/[A-Za-z]/.test(alias)) return new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'iu').test(text);
    return lowered.includes(alias);
  });
  return service && /เช็ก|เช็ค|ดู|เป็นไง|เป็นยังไง|running|okay|check|status|ทำงาน/iu.test(text);
}

function isOfficialOnly(text: string): boolean {
  return includesCue(text, 'เว็บทางการ')
    || includesCue(text, 'แหล่งข้อมูลทางการ')
    || includesCue(text, 'แหล่งต้นฉบับ')
    || includesCue(text, 'official documentation')
    || includesCue(text, 'primary source')
    || includesCue(text, 'official sources');
}

function isCompare(text: string): boolean {
  return includesCue(text, 'เทียบข้อมูล')
    || includesCue(text, 'compare sources')
    || includesCue(text, 'compare multiple')
    || includesCue(text, 'ระหว่างสองเว็บ');
}

function wantsLatest(text: string): boolean {
  return includesCue(text, 'ล่าสุด')
    || includesCue(text, 'วันนี้')
    || includesCue(text, 'latest')
    || includesCue(text, 'how recent')
    || includesCue(text, 'current');
}

function isFreshnessFollowUp(text: string): boolean {
  return includesCue(text, 'ล่าสุดเมื่อไร')
    || includesCue(text, 'ล่าสุดเมื่อไหร่')
    || includesCue(text, 'เก่าแค่ไหน')
    || includesCue(text, 'how recent');
}

function extractTopic(text: string): string {
  let leftover = text;
  const strip = [
    ...THAI_RESEARCH_CUES,
    ...ENGLISH_RESEARCH_CUES,
    'jarvis',
    'please',
    'official only',
    'only use',
    'หาเฉพาะ',
    'ให้หน่อย',
    'หน่อย',
    'ครับ',
    'นะ',
    'ล่าสุด',
    'วันนี้',
    'ตอนนี้',
    'current',
    'latest',
    'about',
    'regarding',
    'เรื่องนี้',
    'เกี่ยวกับ',
    'จากหลายแหล่ง',
    'หลายแหล่ง',
    'ระหว่างสองเว็บ',
    'สองเว็บ',
    'multiple sources',
    'the sources',
    'sources',
    'can you',
    'prices',
    'price',
  ];
  for (const cue of strip) {
    leftover = leftover.replace(new RegExp(escapeRegExp(cue), 'ig'), ' ');
  }
  return leftover.replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
}

function isThinTopic(topic: string): boolean {
  const cleaned = topic
    .replace(/ข้อมูลนี้|อันนี้|เรื่องนี้|จากหลายแหล่ง|หลายแหล่ง|ระหว่างสองเว็บ/giu, ' ')
    .replace(/\bthis\b|\bit\b|\bthe\b|\bsources?\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length < 3;
}

function includesCue(text: string, cue: string): boolean {
  return text.toLocaleLowerCase().includes(cue.toLocaleLowerCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

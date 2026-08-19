import { DAYPART_DEFAULTS } from './constants';
import { formatLocalTime, todayLocalDate } from './schedule';
import { addLocalDays, utcToZonedParts } from './timezone';
import type { ParseScheduleErr, ParseScheduleResult, ReminderSchedule, Weekday } from './types';

const WEEKDAYS: Array<{ keys: string[]; day: Weekday }> = [
  { keys: ['monday', 'วันจันทร์', 'จันทร์'], day: 1 },
  { keys: ['tuesday', 'วันอังคาร', 'อังคาร'], day: 2 },
  { keys: ['wednesday', 'วันพุธ', 'พุธ'], day: 3 },
  { keys: ['thursday', 'วันพฤหัสบดี', 'วันพฤหัส', 'พฤหัสบดี', 'พฤหัส'], day: 4 },
  { keys: ['friday', 'วันศุกร์', 'ศุกร์'], day: 5 },
  { keys: ['saturday', 'วันเสาร์', 'เสาร์'], day: 6 },
  { keys: ['sunday', 'วันอาทิตย์', 'อาทิตย์'], day: 7 },
];

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const THAI_RELATIVE_NUM: Record<string, number> = {
  หนึ่ง: 1,
  สอง: 2,
  สาม: 3,
  สี่: 4,
  ห้า: 5,
};

export function parseScheduleText(
  text: string,
  nowMs: number,
  timeZone: string,
): ParseScheduleResult {
  const raw = text.trim();
  if (!raw) {
    return { ok: false, reasonCode: 'INVALID', userMessage: 'I need a time for that reminder.' };
  }

  const relative = parseRelative(raw);
  if (relative) return relative;

  const recurring = parseRecurring(raw, nowMs, timeZone);
  if (recurring) return recurring;

  const absolute = parseAbsolute(raw, nowMs, timeZone);
  if (absolute) return absolute;

  if (hasWeekdayOnly(raw) && !extractClock(raw)) {
    return {
      ok: false,
      reasonCode: 'CLARIFY',
      userMessage: 'What time on that day should I remind you?',
    };
  }

  return { ok: false, reasonCode: 'INVALID', userMessage: 'I could not understand that reminder time.' };
}

export function extractReminderTitle(text: string): string {
  let leftover = text;
  leftover = leftover.replace(/เตือน(ผม|ฉัน|หนู|ดิฉัน|เรา)?/g, ' ');
  leftover = leftover.replace(/remind(?:er)?(?:\s+me)?(?:\s+to)?/ig, ' ');
  leftover = leftover.replace(/set a reminder(?:\s+to)?/ig, ' ');
  leftover = leftover.replace(/มี reminder อะไรบ้าง|list reminders?|what reminders?/ig, ' ');
  leftover = leftover.replace(/ยกเลิก|cancel|pause|พัก|resume|ทำงานต่อ|เลื่อน|snooze|complete|done/ig, ' ');
  leftover = leftover.replace(/อีก\s*(?:ครึ่ง|\d+|หนึ่ง|สอง|สาม|สี่|ห้า)\s*(?:วินาที|นาที|ชั่วโมง|ชม\.?)/g, ' ');
  leftover = leftover.replace(/in\s+(?:half an hour|\d+\s*(?:seconds?|minutes?|hours?))/ig, ' ');
  leftover = leftover.replace(/ทุกวัน(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์)?/g, ' ');
  leftover = leftover.replace(/every\s+(?:day|monday|tuesday|wednesday|thursday|friday|saturday|sunday)/ig, ' ');
  leftover = leftover.replace(/จันทร์ถึงศุกร์|weekdays?|mon(?:day)?[-–]fri(?:day)?/ig, ' ');
  leftover = leftover.replace(/พรุ่งนี้|วันนี้|tomorrow|today|tonight/g, ' ');
  leftover = leftover.replace(/ตอนเช้า|ช่วงเช้า|เช้านี้|ตอนเย็น|ช่วงเย็น|บ่าย|เที่ยง|ดึก|ค่ำ/g, ' ');
  leftover = leftover.replace(/\b(?:this )?(?:morning|afternoon|evening|noon)\b/ig, ' ');
  leftover = leftover.replace(/\btonight\b|\bat night\b/ig, ' ');
  leftover = leftover.replace(/\d{1,2}(?::\d{2})?\s*(?:โมง(?:เช้า|เย็น|บ่าย)?|ทุ่ม|นาฬิกา)?/g, ' ');
  leftover = leftover.replace(/\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)/ig, ' ');
  leftover = leftover.replace(/at\s+\d{1,2}(?::\d{2})?/ig, ' ');
  leftover = leftover.replace(/august|january|february|march|april|may|june|july|september|october|november|december/ig, ' ');
  leftover = leftover.replace(/ให้(?=\s)/g, ' ');
  leftover = leftover.replace(/ครับ|นะ|หน่อย|please|the|to|for|อันที่|เรื่อง/g, ' ');
  leftover = leftover.replace(/\s+/g, ' ').trim().replace(/^ให้/u, '').trim();
  return leftover.slice(0, 200);
}

function parseRelative(text: string): ParseScheduleResult | undefined {
  const half = /อีก\s*ครึ่ง\s*(?:ชั่วโมง|ชม\.?)|in half an hour/iu;
  if (half.test(text)) {
    return { ok: true, schedule: { kind: 'once_relative', offsetMs: 30 * 60_000 } };
  }
  const numeric = text.match(/อีก\s*(\d+)\s*(วินาที|นาที|ชั่วโมง|ชม\.?)|in\s+(\d+)\s*(seconds?|minutes?|hours?)/iu);
  if (numeric) {
    const amount = Number(numeric[1] || numeric[3]);
    const unit = String(numeric[2] || numeric[4]).toLocaleLowerCase();
    return { ok: true, schedule: { kind: 'once_relative', offsetMs: unitMs(amount, unit) } };
  }
  const thaiWord = text.match(/อีก\s*(หนึ่ง|สอง|สาม|สี่|ห้า)\s*(วินาที|นาที|ชั่วโมง|ชม\.?)/u);
  if (thaiWord) {
    return { ok: true, schedule: { kind: 'once_relative', offsetMs: unitMs(THAI_RELATIVE_NUM[thaiWord[1]] || 1, thaiWord[2]) } };
  }
  return undefined;
}

function parseRecurring(text: string, nowMs: number, timeZone: string): ParseScheduleResult | undefined {
  const weekdays = /จันทร์ถึงศุกร์|weekdays?|every weekday|mon(?:day)?\s*[-–to]+\s*fri(?:day)?/iu.test(text);
  const daily = /ทุกวัน(?!จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์)|every day/iu.test(text);
  const weeklyDay = matchWeekday(text);
  const weeklyCue = /ทุกวัน(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|พฤหัส|ศุกร์|เสาร์|อาทิตย์)|every\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)/iu.test(text);
  if (!daily && !weekdays && !weeklyCue) return undefined;

  const clock = resolveClock(text, { allowBareHour: true });
  if (isParseError(clock)) return clock;
  if (!clock) {
    return { ok: false, reasonCode: 'CLARIFY', userMessage: 'What time should that repeating reminder use?' };
  }

  if (weekdays) {
    return { ok: true, schedule: { kind: 'weekdays', days: [1, 2, 3, 4, 5], localTime: clock.localTime } };
  }
  if (weeklyCue && weeklyDay) {
    return { ok: true, schedule: { kind: 'weekly', weekday: weeklyDay, localTime: clock.localTime } };
  }
  if (daily) {
    return { ok: true, schedule: { kind: 'daily', localTime: clock.localTime } };
  }
  void nowMs;
  void timeZone;
  return undefined;
}

function parseAbsolute(text: string, nowMs: number, timeZone: string): ParseScheduleResult | undefined {
  const clock = resolveClock(text, { allowBareHour: false });
  if (isParseError(clock)) return clock;

  const named = parseNamedDate(text, nowMs, timeZone);
  const dayShift = /พรุ่งนี้|tomorrow/iu.test(text) ? 1 : /วันนี้|today|tonight/iu.test(text) ? 0 : named ? 0 : undefined;
  if (dayShift === undefined && !named && !clock) return undefined;

  if (!clock) {
    const daypart = resolveDaypart(text);
    if (!daypart && dayShift !== undefined) {
      return { ok: false, reasonCode: 'CLARIFY', userMessage: 'What time should I remind you?' };
    }
    if (!daypart && !named) return undefined;
    const localDate = named?.localDate || shiftedDate(nowMs, timeZone, dayShift ?? 0);
    const localTime = named?.localTime || daypart || DAYPART_DEFAULTS.morning;
    return { ok: true, schedule: { kind: 'once_absolute', localDate, localTime } };
  }

  const localDate = named?.localDate || shiftedDate(nowMs, timeZone, dayShift ?? 0);
  return { ok: true, schedule: { kind: 'once_absolute', localDate, localTime: clock.localTime } };
}

function isParseError(value: { localTime: string } | ParseScheduleErr | undefined): value is ParseScheduleErr {
  return Boolean(value && 'ok' in value && value.ok === false);
}

function resolveClock(
  text: string,
  options: { allowBareHour: boolean },
): { localTime: string } | ParseScheduleErr | undefined {
  const daypart = resolveDaypart(text);
  const explicit24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/u);
  if (explicit24 && /:/.test(explicit24[0]) && !/(โมง|ทุ่ม|a\.?m\.?|p\.?m\.?)/iu.test(text)) {
    return { localTime: formatLocalTime(Number(explicit24[1]), Number(explicit24[2])) };
  }

  const ampm = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/iu);
  if (ampm) {
    const converted = fromTwelveHour(Number(ampm[1]), Number(ampm[2] || 0), /p/iu.test(ampm[3]));
    if (!converted) return { ok: false, reasonCode: 'INVALID', userMessage: 'That clock time is invalid.' };
    return { localTime: formatLocalTime(converted.hour, converted.minute) };
  }

  const thum = text.match(/(\d{1,2})\s*ทุ่ม(?:\s*(\d{1,2}))?/u);
  if (thum) {
    const hour = Number(thum[1]);
    if (hour < 1 || hour > 6) return { ok: false, reasonCode: 'INVALID', userMessage: 'That ทุ่ม time is invalid.' };
    return { localTime: formatLocalTime(18 + hour, Number(thum[2] || 0)) };
  }

  const tee = text.match(/ตี\s*(\d{1,2})/u);
  if (tee) {
    const hour = Number(tee[1]);
    if (hour < 1 || hour > 5) return { ok: false, reasonCode: 'INVALID', userMessage: 'That ตี time is invalid.' };
    return { localTime: formatLocalTime(hour, 0) };
  }

  const mong = text.match(/(\d{1,2})(?::(\d{2}))?\s*โมง(เช้า|เย็น|บ่าย)?/u);
  if (mong) {
    const hour = Number(mong[1]);
    const minute = Number(mong[2] || 0);
    const suffix = mong[3] || '';
    if (hour < 1 || hour > 12) return { ok: false, reasonCode: 'INVALID', userMessage: 'That โมง time is invalid.' };
    if (!suffix) {
      if (!options.allowBareHour && !daypart) {
        return {
          ok: false,
          reasonCode: 'AMBIGUOUS_TIME',
          userMessage: 'Did you mean morning or evening? For example 7 โมงเช้า or 7 โมงเย็น.',
        };
      }
      if (daypart === DAYPART_DEFAULTS.evening || suffix === 'เย็น') {
        return { localTime: formatLocalTime(hour === 12 ? 12 : hour + 12, minute) };
      }
      if (daypart === DAYPART_DEFAULTS.afternoon || suffix === 'บ่าย') {
        return { localTime: formatLocalTime(hour === 12 ? 12 : hour + 12, minute) };
      }
      return { localTime: formatLocalTime(hour === 12 ? 0 : hour, minute) };
    }
    if (suffix === 'เช้า') return { localTime: formatLocalTime(hour === 12 ? 0 : hour, minute) };
    return { localTime: formatLocalTime(hour === 12 ? 12 : hour + 12, minute) };
  }

  if (daypart) return { localTime: daypart };

  const englishAt = text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/iu);
  if (englishAt) {
    const hour = Number(englishAt[1]);
    const minute = Number(englishAt[2] || 0);
    if (hour > 23) return { ok: false, reasonCode: 'INVALID', userMessage: 'That clock time is invalid.' };
    if (hour <= 12 && !/a\.?m\.?|p\.?m\.?/iu.test(text) && !daypart) {
      return {
        ok: false,
        reasonCode: 'AMBIGUOUS_TIME',
        userMessage: 'Did you mean AM or PM?',
      };
    }
    return { localTime: formatLocalTime(hour, minute) };
  }

  return undefined;
}

function resolveDaypart(text: string): string | undefined {
  if (/เที่ยง|noon/iu.test(text)) return DAYPART_DEFAULTS.noon;
  if (/ช่วงเช้า|ตอนเช้า|เช้านี้|morning/iu.test(text)) return DAYPART_DEFAULTS.morning;
  if (/บ่าย|afternoon/iu.test(text)) return DAYPART_DEFAULTS.afternoon;
  if (/ช่วงเย็น|ตอนเย็น|เย็น|evening|tonight/iu.test(text)) return DAYPART_DEFAULTS.evening;
  if (/ดึก|ค่ำ|\bat night\b|(?:tomorrow|today|วันนี้|พรุ่งนี้)\s+night\b/iu.test(text)) {
    return DAYPART_DEFAULTS.night;
  }
  return undefined;
}

function parseNamedDate(
  text: string,
  nowMs: number,
  timeZone: string,
): { localDate: string; localTime?: string } | undefined {
  const match = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?/iu);
  if (!match) return undefined;
  const now = utcToZonedParts(nowMs, timeZone);
  const month = MONTHS[match[1].toLocaleLowerCase()];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : now.year;
  const localDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const clock = text.match(/\b(\d{1,2}):(\d{2})\b/u);
  return {
    localDate,
    localTime: clock ? formatLocalTime(Number(clock[1]), Number(clock[2])) : undefined,
  };
}

function shiftedDate(nowMs: number, timeZone: string, days: number): string {
  const now = utcToZonedParts(nowMs, timeZone);
  const shifted = addLocalDays(now, days);
  return `${shifted.year}-${String(shifted.month).padStart(2, '0')}-${String(shifted.day).padStart(2, '0')}`;
}

function matchWeekday(text: string): Weekday | undefined {
  const lowered = text.toLocaleLowerCase();
  for (const item of WEEKDAYS) {
    if (item.keys.some(key => lowered.includes(key))) return item.day;
  }
  return undefined;
}

function hasWeekdayOnly(text: string): boolean {
  return Boolean(matchWeekday(text)) && /วัน|on /iu.test(text);
}

function extractClock(text: string): boolean {
  return /\d/.test(text) || /โมง|ทุ่ม|morning|evening|เช้า|เย็น/iu.test(text);
}

function fromTwelveHour(hour: number, minute: number, pm: boolean): { hour: number; minute: number } | undefined {
  if (hour < 1 || hour > 12 || minute > 59) return undefined;
  let normalized = hour % 12;
  if (pm) normalized += 12;
  return { hour: normalized, minute };
}

function unitMs(amount: number, unit: string): number {
  if (/วินาที|second/iu.test(unit)) return amount * 1_000;
  if (/ชั่วโมง|ชม|hour/iu.test(unit)) return amount * 60 * 60_000;
  return amount * 60_000;
}

export function reminderTextAsData(value: string, max = 200): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export { todayLocalDate };

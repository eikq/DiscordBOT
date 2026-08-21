/**
 * Honest monitor topology. Never invent a display that was not observed.
 */

export type DisplayRole = 'primary' | 'secondary' | 'left' | 'right' | 'upper' | 'lower' | 'current' | 'internal' | 'other';

export type DisplayInfo = {
  id: string;
  name: string;
  primary: boolean;
  internal?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DisplaySelector = {
  index?: number;
  role?: DisplayRole;
  name?: string;
  raw: string;
};

export type DisplayResolveOk = { ok: true; display: DisplayInfo; confidence: 'HIGH' | 'MEDIUM' };
export type DisplayResolveFail = {
  ok: false;
  reasonCode:
    | 'DISPLAY_TOPOLOGY_UNKNOWN'
    | 'DISPLAY_NOT_FOUND'
    | 'DISPLAY_AMBIGUOUS'
    | 'DISPLAY_SELECTOR_MISSING';
  message: string;
  candidates?: DisplayInfo[];
};

export function parseDisplaySelector(text: string): DisplaySelector | null {
  const raw = text.trim();
  if (!raw) return null;
  const numbered = raw.match(/(?:monitor|display|screen|จอ(?:ที่|ที่หมายเลข)?)\s*(?:number\s*)?(\d+|one|two|three|four|first|second|third|หนึ่ง|สอง|สาม)/iu);
  if (numbered?.[1]) {
    const index = ordinalToIndex(numbered[1]);
    if (index) return { index, raw };
  }
  if (/notebook|note\s*book|laptop|built-?in|internal|จอโน้ตบุ๊ก|จอโน้ต|จอเครื่อง/iu.test(raw)) {
    return { role: 'internal', raw };
  }
  if (/\bother (?:monitor|display|screen)\b|จออื่น|อีกจอ/iu.test(raw)) return { role: 'other', raw };
  if (/main|primary|จอหลัก/iu.test(raw)) return { role: 'primary', raw };
  if (/second(?:ary)?|external|จอสอง|จอภายนอก|จอที่สอง/iu.test(raw)) return { role: 'secondary', raw };
  if (/\bleft\b|จอซ้าย/iu.test(raw)) return { role: 'left', raw };
  if (/\bright\b|จอขวา/iu.test(raw)) return { role: 'right', raw };
  if (/upper|top (?:monitor|display|screen)|จอบน/iu.test(raw)) return { role: 'upper', raw };
  if (/lower|bottom (?:monitor|display|screen)|จอล่าง/iu.test(raw)) return { role: 'lower', raw };
  if (/this window|current (?:monitor|display)|หน้าต่างนี้/iu.test(raw)) return { role: 'current', raw };
  return null;
}

export function resolveDisplaySelector(
  displays: DisplayInfo[],
  selector: DisplaySelector | null | undefined,
  currentDisplayId?: string,
): DisplayResolveOk | DisplayResolveFail {
  if (!selector) return { ok: false, reasonCode: 'DISPLAY_SELECTOR_MISSING', message: 'No monitor target was specified.' };
  if (displays.length === 0) {
    return { ok: false, reasonCode: 'DISPLAY_TOPOLOGY_UNKNOWN', message: 'I cannot verify the monitor layout right now.' };
  }
  if (selector.index !== undefined) {
    const hit = displays[selector.index - 1];
    if (!hit) {
      return {
        ok: false,
        reasonCode: 'DISPLAY_NOT_FOUND',
        message: `I only see ${displays.length} display${displays.length === 1 ? '' : 's'}. There is no monitor ${selector.index}.`,
        candidates: displays,
      };
    }
    return { ok: true, display: hit, confidence: 'HIGH' };
  }
  if (selector.name) {
    const needle = normalize(selector.name);
    const hits = displays.filter(item => normalize(item.name) === needle || normalize(item.id) === needle);
    if (hits.length === 1) return { ok: true, display: hits[0], confidence: 'HIGH' };
    if (hits.length === 0) {
      return { ok: false, reasonCode: 'DISPLAY_NOT_FOUND', message: `No display named “${selector.name}” is visible.`, candidates: displays };
    }
    return ambiguous(displays, 'That display name matches more than one screen.');
  }
  if (selector.role === 'primary') {
    return { ok: true, display: displays.find(item => item.primary) || displays[0], confidence: 'HIGH' };
  }
  if (selector.role === 'current') {
    const hit = displays.find(item => item.id === currentDisplayId) || displays.find(item => item.primary) || displays[0];
    return { ok: true, display: hit, confidence: currentDisplayId ? 'HIGH' : 'MEDIUM' };
  }
  if (selector.role === 'internal') {
    const internals = displays.filter(item => item.internal === true);
    if (internals.length === 1) return { ok: true, display: internals[0]!, confidence: 'HIGH' };
    return {
      ok: false,
      reasonCode: 'DISPLAY_AMBIGUOUS',
      message: "I'm not sure which screen you mean by notebook monitor. Should I use the laptop's built-in display?",
      candidates: displays,
    };
  }
  if (selector.role === 'other') {
    const current = displays.find(item => item.id === currentDisplayId) || displays.find(item => item.primary);
    const others = displays.filter(item => item.id !== current?.id);
    if (others.length === 1) return { ok: true, display: others[0]!, confidence: 'HIGH' };
    return ambiguous(displays, `I see ${displays.length} displays. Which one do you mean by the other monitor?`);
  }
  if (selector.role === 'secondary') {
    const others = displays.filter(item => !item.primary);
    if (others.length === 1) return { ok: true, display: others[0], confidence: 'HIGH' };
    if (others.length === 0) {
      return { ok: false, reasonCode: 'DISPLAY_NOT_FOUND', message: 'No secondary display is connected.', candidates: displays };
    }
    return ambiguous(displays, `I see ${displays.length} displays. Which one do you mean by the second monitor?`);
  }
  if (selector.role === 'left' || selector.role === 'right') {
    return resolveAxis(displays, 'x', selector.role === 'left' ? 'min' : 'max', selector.role);
  }
  if (selector.role === 'upper' || selector.role === 'lower') {
    return resolveAxis(displays, 'y', selector.role === 'upper' ? 'min' : 'max', selector.role);
  }
  return { ok: false, reasonCode: 'DISPLAY_SELECTOR_MISSING', message: 'I could not resolve that monitor reference.' };
}

function resolveAxis(
  displays: DisplayInfo[],
  axis: 'x' | 'y',
  extreme: 'min' | 'max',
  label: string,
): DisplayResolveOk | DisplayResolveFail {
  if (displays.length < 2) {
    return { ok: false, reasonCode: 'DISPLAY_NOT_FOUND', message: `There is no ${label} monitor to distinguish.`, candidates: displays };
  }
  const ranked = [...displays].sort((left, right) => extreme === 'min' ? left[axis] - right[axis] : right[axis] - left[axis]);
  const first = ranked[0];
  const second = ranked[1];
  if (!first || !second || first[axis] === second[axis]) {
    return ambiguous(displays, `I see ${displays.length} displays. Which one do you mean by the ${label} monitor?`);
  }
  return { ok: true, display: first, confidence: 'HIGH' };
}

function ambiguous(displays: DisplayInfo[], message: string): DisplayResolveFail {
  return { ok: false, reasonCode: 'DISPLAY_AMBIGUOUS', message, candidates: displays };
}

function ordinalToIndex(raw: string): number | undefined {
  const map: Record<string, number> = {
    '1': 1, '2': 2, '3': 3, '4': 4,
    one: 1, two: 2, three: 3, four: 4,
    first: 1, second: 2, third: 3,
    'หนึ่ง': 1, 'สอง': 2, 'สาม': 3,
  };
  return map[raw.toLocaleLowerCase()];
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function summarizeDisplays(displays: DisplayInfo[]): string {
  if (displays.length === 0) return 'No displays are visible to Jarvis.';
  return displays.map((item, index) => {
    const role = item.primary ? 'primary' : `monitor ${index + 1}`;
    return `${role}: ${item.width}×${item.height}`;
  }).join('; ');
}

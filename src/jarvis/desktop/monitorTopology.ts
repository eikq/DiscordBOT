/**
 * Honest monitor topology. Never invent a display that was not observed.
 */

import { matchDisplayFingerprint, parseDisplayFingerprint } from './displayIdentity';

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
  deviceName?: string;
  devicePath?: string;
  adapterId?: string;
  targetId?: string;
  manufacturer?: string;
  model?: string;
  serial?: string;
  connectionType?: string;
};

export type DisplaySelector = {
  index?: number;
  role?: DisplayRole;
  name?: string;
  fingerprint?: string;
  raw: string;
};

export type DisplayResolveOk = { ok: true; display: DisplayInfo; confidence: 'HIGH' | 'MEDIUM' };
export type DisplayResolveFail = {
  ok: false;
  reasonCode:
    | 'DISPLAY_TOPOLOGY_UNKNOWN'
    | 'DISPLAY_NOT_FOUND'
    | 'DISPLAY_AMBIGUOUS'
    | 'DISPLAY_SELECTOR_MISSING'
    | 'KNOWN_ALIAS_TARGET_OFFLINE';
  message: string;
  candidates?: DisplayInfo[];
};

const DISPLAY_ROLES = new Set<DisplayRole>([
  'primary', 'secondary', 'left', 'right', 'upper', 'lower', 'current', 'internal', 'other',
]);

export function hasConcreteDisplayIdentity(selector?: DisplaySelector | null): boolean {
  if (!selector) return false;
  if (typeof selector.fingerprint === 'string' && isFingerprintToken(selector.fingerprint)) return true;
  if (typeof selector.name === 'string' && (isFingerprintToken(selector.name) || isDeviceName(selector.name))) return true;
  return typeof selector.index === 'number' && selector.index >= 1;
}

export function preferConcreteDisplay(
  preferred?: DisplaySelector | null,
  fallback?: DisplaySelector | null,
): DisplaySelector | undefined {
  const first = isSelector(preferred) ? preferred : undefined;
  const second = isSelector(fallback) ? fallback : undefined;
  const winner = hasConcreteDisplayIdentity(first) ? first : hasConcreteDisplayIdentity(second) ? second : first || second;
  if (!winner) return undefined;
  if (hasConcreteDisplayIdentity(winner) && winner.role === 'internal') {
    const { role: _role, ...rest } = winner;
    return rest;
  }
  return { ...winner };
}

export function sanitizeDisplaySelector(value: unknown): DisplaySelector | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const selector: DisplaySelector = {
    raw: typeof raw.raw === 'string' ? raw.raw.slice(0, 240) : '',
  };
  if (typeof raw.index === 'number' && Number.isInteger(raw.index) && raw.index >= 1 && raw.index <= 16) {
    selector.index = raw.index;
  }
  if (typeof raw.role === 'string' && DISPLAY_ROLES.has(raw.role as DisplayRole)) {
    selector.role = raw.role as DisplayRole;
  }
  if (typeof raw.name === 'string' && raw.name.trim() && raw.name.length <= 400) {
    selector.name = raw.name;
  }
  if (typeof raw.fingerprint === 'string' && raw.fingerprint.length <= 400 && isFingerprintToken(raw.fingerprint)) {
    selector.fingerprint = raw.fingerprint;
  }
  if (!selector.raw && selector.index === undefined && !selector.role && !selector.name && !selector.fingerprint) {
    return undefined;
  }
  if (selector.fingerprint && selector.role === 'internal') delete selector.role;
  return selector;
}

function isSelector(value: unknown): value is DisplaySelector {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFingerprintToken(value: string): boolean {
  return value.startsWith('display.fp:') || value.startsWith('{');
}

function isDeviceName(value: string): boolean {
  return /^\\\\\.\\DISPLAY/iu.test(value) || /^display-/iu.test(value);
}

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
  if (/this window|current (?:monitor|display)|หน้าต่างนี้|จอนี้/iu.test(raw)) return { role: 'current', raw };
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
  const identity = resolveFingerprintSelector(displays, selector);
  if (identity) return identity;
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

function resolveFingerprintSelector(
  displays: DisplayInfo[],
  selector: DisplaySelector,
): DisplayResolveOk | DisplayResolveFail | undefined {
  const raw = selector.fingerprint || selector.name || '';
  if (!raw.startsWith('display.fp:') && !raw.startsWith('{')) return undefined;
  const fingerprint = parseDisplayFingerprint(raw);
  if (!fingerprint) {
    return { ok: false, reasonCode: 'KNOWN_ALIAS_TARGET_OFFLINE', message: 'That stored monitor identity is not valid.' };
  }
  const matched = matchDisplayFingerprint(displays, fingerprint);
  if (matched.ok === true) return { ok: true, display: matched.display, confidence: matched.confidence };
  return { ok: false, reasonCode: 'KNOWN_ALIAS_TARGET_OFFLINE', message: matched.message, candidates: displays };
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

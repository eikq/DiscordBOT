import {
  DESKTOP_FOCUS_JARVIS_WINDOW,
  DESKTOP_GET_JARVIS_WINDOW,
  DESKTOP_LIST_DISPLAYS,
  DESKTOP_MOVE_JARVIS_WINDOW,
  DESKTOP_SET_JARVIS_LAYOUT,
  type DisplaySelector,
  type JarvisLayout,
} from './types';

export type DesktopPresenceIntent =
  | { kind: 'none' }
  | {
    kind: 'action';
    capabilityId: string;
    arguments: Record<string, unknown>;
    consumed: true;
    reasonCode: string;
  }
  | { kind: 'clarify'; question: string; reasonCode: string };

const MOVE = /ย้ายตัว|ย้ายไปจอ|ไปจอหลัก|ไปจอโน้ต|ย้ายหน้าต่าง|move yourself|move (the )?(jarvis )?window to|move to (the )?(main|external|notebook|primary|monitor|display|จอ)/iu;
const LIST = /how many (monitors|displays)|กี่จอ|list displays|มีกี่จอ/iu;
const CURRENT = /which (monitor|display)|อยู่จอไหน|what display|current display\??$/iu;
const FOCUS = /focus (your|the)? ?window|โฟกัสหน้าต่าง/iu;
const MAXIMIZE = /maximize|เต็มจอ|maximize on/iu;
const PRESENTER = /presenter mode|โหมดนำเสนอ|open presenter/iu;
const RESTORE = /restore (to )?(the )?(original|previous) display|กลับจอเดิม/iu;

export function inferDesktopPresenceIntent(text: string): DesktopPresenceIntent {
  const raw = text.trim();
  if (!raw) return { kind: 'none' };

  if (RESTORE.test(raw)) {
    return action(DESKTOP_SET_JARVIS_LAYOUT, { layout: 'restore' }, 'HEURISTIC_WINDOW_RESTORE');
  }
  if (LIST.test(raw)) {
    return action(DESKTOP_LIST_DISPLAYS, {}, 'HEURISTIC_LIST_DISPLAYS');
  }
  if (PRESENTER.test(raw)) {
    const selector = parseDisplaySelector(raw);
    return action(DESKTOP_SET_JARVIS_LAYOUT, {
      layout: 'presenter',
      ...(selector ? { displaySelector: selector } : {}),
    }, 'HEURISTIC_PRESENTER_LAYOUT');
  }
  if (MAXIMIZE.test(raw) && /display|monitor|จอ|current/iu.test(raw)) {
    return action(DESKTOP_SET_JARVIS_LAYOUT, {
      layout: 'maximized',
      displaySelector: parseDisplaySelector(raw) || { role: 'current' },
    }, 'HEURISTIC_MAXIMIZE_CURRENT');
  }
  if (CURRENT.test(raw) && !MOVE.test(raw)) {
    return action(DESKTOP_GET_JARVIS_WINDOW, {}, 'HEURISTIC_CURRENT_DISPLAY');
  }
  if (MOVE.test(raw)) {
    const selector = parseDisplaySelector(raw);
    if (!selector) {
      return {
        kind: 'clarify',
        question: 'ย้ายไปจอไหนครับ? ระบุ monitor 2, จอหลัก, จอภายนอก, หรือชื่อที่ตั้งไว้',
        reasonCode: 'AMBIGUOUS_DISPLAY',
      };
    }
    return action(DESKTOP_MOVE_JARVIS_WINDOW, { displaySelector: selector }, 'HEURISTIC_MOVE_WINDOW');
  }
  if (FOCUS.test(raw)) {
    return action(DESKTOP_FOCUS_JARVIS_WINDOW, {}, 'HEURISTIC_FOCUS_WINDOW');
  }
  return { kind: 'none' };
}

export function parseDisplaySelector(text: string): DisplaySelector | undefined {
  const numbered = text.match(/(?:monitor|display|จอ)\s*(\d+)/iu);
  if (numbered) return { index: Number(numbered[1]) };
  if (/primary( display| monitor)?|จอหลักของระบบ/iu.test(text)) return { role: 'primary' };
  if (/main monitor|จอหลัก|\bmain\b/iu.test(text)) return { role: 'main' };
  if (/notebook|laptop|จอโน้ต/iu.test(text)) return { role: 'notebook' };
  if (/external|จอสอง|จอภายนอก|second (monitor|display)/iu.test(text)) return { role: 'external' };
  if (/current display|จอปัจจุบัน/iu.test(text)) return { role: 'current' };
  const named = text.match(/(?:named|ชื่อ)\s+["“]?([\p{L}\p{N} _.-]{2,32})["”]?/u);
  if (named) return { name: named[1].trim() };
  return undefined;
}

export function parseLayout(text: string): JarvisLayout | undefined {
  if (/restore|กลับจอเดิม/iu.test(text)) return 'restore';
  if (/presenter|นำเสนอ/iu.test(text)) return 'presenter';
  if (/maximize|เต็มจอ/iu.test(text)) return 'maximized';
  if (/minimize/iu.test(text)) return 'minimized';
  if (/normal|restore size/iu.test(text)) return 'normal';
  return undefined;
}

function action(capabilityId: string, args: Record<string, unknown>, reasonCode: string): DesktopPresenceIntent {
  return { kind: 'action', capabilityId, arguments: args, consumed: true, reasonCode };
}

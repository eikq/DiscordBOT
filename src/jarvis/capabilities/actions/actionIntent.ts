import { inferReminderIntent } from '../../automation/reminderIntent';
import { inferResearchIntent } from '../../research/researchIntent';
import { inferWorkspaceIntent } from '../../workspace/workspaceIntent';
import {
  APPLICATIONS_STATUS,
  DESKTOP_FOCUS_WINDOW,
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_OPEN_SETTINGS,
  DESKTOP_OPEN_TRUSTED_URL,
  DESKTOP_PLACE_WINDOW,
  JARVIS_HEALTH_CHECK,
  JARVIS_RESTART_SERVICE,
  JARVIS_RUNTIME_STATUS,
  JARVIS_START_SERVICE,
  JARVIS_STOP_SERVICE,
  SYSTEM_BATTERY_STATUS,
  SYSTEM_NETWORK_STATUS,
  SYSTEM_STATUS,
} from './constants';
import { classifyVoiceFamily } from '../../intent/voiceFamilies';
import { SERVICE_ALIASES, type JarvisServiceId } from './services/catalog';
import type { CapabilityCall } from './types';

export type ActionIntent =
  | { kind: 'none' }
  | { kind: 'blocked'; reasonCode: string; userMessage: string }
  | { kind: 'unsupported'; reasonCode: string; userMessage: string }
  | { kind: 'action'; consumed: boolean; calls: CapabilityCall[] };

const APPLICATION_ALIASES: Record<string, string> = {
  notepad: 'notepad',
  'notepad.exe': 'notepad',
  calculator: 'calculator',
  calc: 'calculator',
  'calc.exe': 'calculator',
  'เครื่องคิดเลข': 'calculator',
  explorer: 'explorer',
  'file explorer': 'explorer',
  'explorer.exe': 'explorer',
  spotify: 'spotify',
  edge: 'msedge',
  msedge: 'msedge',
  chrome: 'chrome',
  'โครม': 'chrome',
  'กูเกิลโครม': 'chrome',
  browser: 'browser',
  'เบราว์เซอร์': 'browser',
  'บราวเซอร์': 'browser',
  'โน้ตแพด': 'notepad',
  'โน๊ตแพด': 'notepad',
  'สปอติฟาย': 'spotify',
  cursor: 'cursor',
};

const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reasonCode: string }> = [
  { pattern: /powershell/iu, reasonCode: 'BLOCKED_SHELL' },
  { pattern: /\bpwsh\b/iu, reasonCode: 'BLOCKED_SHELL' },
  { pattern: /cmd\.exe/iu, reasonCode: 'BLOCKED_SHELL' },
  { pattern: /command\.com/iu, reasonCode: 'BLOCKED_SHELL' },
  { pattern: /system32/iu, reasonCode: 'BLOCKED_SYSTEM_PATH' },
  { pattern: /regedit|registry/iu, reasonCode: 'BLOCKED_REGISTRY' },
  { pattern: /ignore permissions/iu, reasonCode: 'BLOCKED_POLICY_BYPASS' },
  { pattern: /bypass (the )?policy/iu, reasonCode: 'BLOCKED_POLICY_BYPASS' },
  { pattern: /bypass confirmation/iu, reasonCode: 'BLOCKED_POLICY_BYPASS' },
  { pattern: /winget|chocolatey|\bchoco\b/iu, reasonCode: 'BLOCKED_INSTALL' },
  { pattern: /shutdown|reboot/iu, reasonCode: 'BLOCKED_POWER' },
  { pattern: /ลบ.*system32/iu, reasonCode: 'BLOCKED_DELETE' },
  { pattern: /arbitrary executable/iu, reasonCode: 'BLOCKED_ARBITRARY_EXECUTABLE' },
  { pattern: /\bpid\b|\bprocess\s+\d+/iu, reasonCode: 'BLOCKED_GENERIC_PROCESS' },
  { pattern: /ms-settings:/iu, reasonCode: 'BLOCKED_SETTINGS_URI' },
  { pattern: /restart all windows services|system service manager|service manager/iu, reasonCode: 'BLOCKED_GENERIC_PROCESS' },
  { pattern: /add .+\s+to (the )?registry/iu, reasonCode: 'BLOCKED_GENERIC_PROCESS' },
  { pattern: /kill process|stop process/iu, reasonCode: 'BLOCKED_GENERIC_PROCESS' },
];

const CONFIRM_UTTERANCE = /^(yes|y|ok|okay|allow|allow once|ได้|ตกลง|อนุญาต|เปิดได้|เอาเลย|ใช่)$/iu;

export function isExplicitActionConfirmation(text: string): boolean {
  return CONFIRM_UTTERANCE.test(text.trim());
}

export function inferActionIntent(
  text: string,
  options: { applicationIds?: string[]; projectIds?: string[] } = {},
): ActionIntent {
  const raw = text.trim();
  if (!raw) return { kind: 'none' };

  const reminder = inferReminderIntent(raw);
  if (reminder.kind !== 'none') return reminder;

  const workspace = inferWorkspaceIntent(raw);
  if (workspace.kind !== 'none') return workspace;

  const research = inferResearchIntent(raw);
  if (research.kind !== 'none') return research;

  for (const item of BLOCKED_PATTERNS) {
    if (!item.pattern.test(raw)) continue;
    if (isConversationAboutBlockedTopic(raw, item.reasonCode)) continue;
    return {
      kind: 'blocked',
      reasonCode: item.reasonCode,
      userMessage: 'ทำรายการนี้ไม่ได้ครับ',
    };
  }

  if ((/[A-Za-z]:\\/u.test(raw) || /\\\\/u.test(raw) || /\.(bat|cmd|ps1|msi)\b/iu.test(raw)) && !isConversationAboutBlockedTopic(raw, 'BLOCKED_ARBITRARY_PATH')) {
    return {
      kind: 'blocked',
      reasonCode: 'BLOCKED_ARBITRARY_PATH',
      userMessage: 'ทำรายการนี้ไม่ได้ครับ',
    };
  }
  if (/\.exe\b/iu.test(raw) && !/\b(?:notepad|calc|explorer)\.exe\b/iu.test(raw) && !isConversationAboutBlockedTopic(raw, 'BLOCKED_ARBITRARY_EXECUTABLE')) {
    return {
      kind: 'blocked',
      reasonCode: 'BLOCKED_ARBITRARY_EXECUTABLE',
      userMessage: 'ทำรายการนี้ไม่ได้ครับ',
    };
  }

  const urlMatch = raw.match(/\b((?:javascript|file|data|vbscript|about|https?|shell):[^\s]+)/iu);
  if (urlMatch?.[1]) {
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, urlMatch[1]),
      calls: [{ id: DESKTOP_OPEN_TRUSTED_URL, input: { url: urlMatch[1] } }],
    };
  }

  const voiceEarly = classifyVoiceFamily(raw);
  if (voiceEarly.family === 'SYSTEM_STATUS') {
    return { kind: 'action', consumed: true, calls: [{ id: SYSTEM_STATUS, input: {} }] };
  }
  if (voiceEarly.family === 'COMPOUND_OPEN' && voiceEarly.resources.length >= 2) {
    return {
      kind: 'action',
      consumed: true,
      calls: voiceEarly.resources.map(resource => scopedOpenCall(resource)),
    };
  }
  if (voiceEarly.family === 'DESKTOP_OPEN' && voiceEarly.display && voiceEarly.resources[0]) {
    return {
      kind: 'action',
      consumed: true,
      calls: [scopedOpenCall(voiceEarly.resources[0])],
    };
  }
  if (voiceEarly.family === 'DESKTOP_PLACE' && voiceEarly.resources[0]?.applicationId) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{
        id: DESKTOP_PLACE_WINDOW,
        input: { applicationId: voiceEarly.resources[0].applicationId, ...(voiceEarly.display ? { display: voiceEarly.display } : {}) },
      }],
    };
  }

  const settingsId = matchSettings(raw);
  if (settingsId && (hasActionVerb(raw, ['open', 'เปิด', 'settings', 'ตั้งค่า']) || /settings|ตั้งค่า/iu.test(raw))) {
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, settingsId),
      calls: [{ id: DESKTOP_OPEN_SETTINGS, input: { settingsId } }],
    };
  }

  const serviceId = matchService(raw);
  if (serviceId && hasActionVerb(raw, ['restart', 'รีสตาร์ต', 'รีสตาร์ท'])) {
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, serviceId),
      calls: [{ id: JARVIS_RESTART_SERVICE, input: { serviceId } }],
    };
  }
  if (serviceId && hasActionVerb(raw, ['stop', 'ปิด', 'หยุด'])) {
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, serviceId),
      calls: [{ id: JARVIS_STOP_SERVICE, input: { serviceId } }],
    };
  }
  if (serviceId && hasActionVerb(raw, ['start', 'เริ่ม', 'เปิด'])) {
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, serviceId),
      calls: [{ id: JARVIS_START_SERVICE, input: { serviceId } }],
    };
  }
  if (serviceId && hasActionVerb(raw, ['running', 'online', 'ทำงาน', 'ออนไลน์', 'reachable', 'เช็ก', 'เช็ค', 'ดู', 'เป็นไง', 'เป็นยังไง', 'okay', 'check'])) {
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, serviceId),
      calls: [{ id: JARVIS_HEALTH_CHECK, input: { serviceId } }],
    };
  }

  const applicationId = matchApplication(raw, options.applicationIds ?? Object.values(APPLICATION_ALIASES));
  if (applicationId && hasActionVerb(raw, ['stop', 'kill', 'ปิด', 'หยุด']) && !hasActionVerb(raw, ['open', 'เปิด'])) {
    return { kind: 'blocked', reasonCode: 'BLOCKED_GENERIC_PROCESS', userMessage: 'ทำรายการนี้ไม่ได้ครับ' };
  }
  if (applicationId && hasActionVerb(raw, ['installed', 'install', 'ติดตั้ง', 'มีอยู่'])) {
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, applicationId),
      calls: [{ id: APPLICATIONS_STATUS, input: { applicationId } }],
    };
  }
  if (applicationId && hasActionVerb(raw, ['open', 'launch', 'start', 'เปิด', 'เข้า', 'ช่วยเปิด'])) {
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, applicationId),
      calls: [{ id: DESKTOP_OPEN_APPLICATION, input: { applicationId } }],
    };
  }

  if (hasActionVerb(raw, ['battery', 'แบต', 'แบตเตอรี่'])) {
    return { kind: 'action', consumed: leftoverIsNoise(raw, 'battery'), calls: [{ id: SYSTEM_BATTERY_STATUS, input: {} }] };
  }
  if (hasActionVerb(raw, ['network', 'เน็ต', 'อินเทอร์เน็ต', 'ต่อเน็ต'])) {
    return { kind: 'action', consumed: leftoverIsNoise(raw, 'network'), calls: [{ id: SYSTEM_NETWORK_STATUS, input: {} }] };
  }
  if (hasActionVerb(raw, ['ตัวนาย', 'runtime status', 'jarvis status']) || (hasActionVerb(raw, ['ทำงานปกติ']) && /jarvis|ตัวนาย/iu.test(raw))) {
    return { kind: 'action', consumed: leftoverIsNoise(raw, 'runtime'), calls: [{ id: JARVIS_RUNTIME_STATUS, input: {} }] };
  }

  if (hasActionVerb(raw, ['system status', 'สถานะระบบ']) || (hasActionVerb(raw, ['status']) && /system/iu.test(raw)) || (hasThai(raw, 'ระบบ') && hasThai(raw, 'เป็นยังไง'))) {
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, 'status'),
      calls: [{ id: SYSTEM_STATUS, input: {} }],
    };
  }

  const voice = classifyVoiceFamily(raw);
  if (voice.family === 'UNSUPPORTED_COMPUTER_USE') {
    return {
      kind: 'unsupported',
      reasonCode: 'UNSUPPORTED_DESKTOP_SCOPE',
      userMessage: 'That would require CLICK, TYPE, or SUBMIT, which is not enabled. I can open an allowlisted app or site.',
    };
  }
  if (voice.family === 'COMPOUND_OPEN' && voice.resources.length >= 2) {
    return {
      kind: 'action',
      consumed: true,
      calls: voice.resources.map(resource => scopedOpenCall(resource)),
    };
  }
  if (voice.family === 'DESKTOP_PLACE' && voice.resources[0]?.applicationId) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{
        id: DESKTOP_PLACE_WINDOW,
        input: { applicationId: voice.resources[0].applicationId, ...(voice.display ? { display: voice.display } : {}) },
      }],
    };
  }
  if (voice.family === 'DESKTOP_FOCUS' && voice.resources[0]?.applicationId) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{ id: DESKTOP_FOCUS_WINDOW, input: { applicationId: voice.resources[0].applicationId } }],
    };
  }
  if (voice.family === 'DESKTOP_OPEN' && voice.display && voice.resources[0]) {
    return {
      kind: 'action',
      consumed: true,
      calls: [scopedOpenCall(voice.resources[0])],
    };
  }

  if (hasActionVerb(raw, ['open', 'เปิด']) && hasActionVerb(raw, ['project', 'โปรเจกต์', 'โฟลเดอร์', 'jarvis-project'])) {
    const projectId = (options.projectIds ?? []).includes('jarvis-project')
      ? 'jarvis-project'
      : (options.projectIds?.[0] ?? 'jarvis-project');
    return {
      kind: 'action',
      consumed: leftoverIsNoise(raw, projectId),
      calls: [{ id: DESKTOP_OPEN_PROJECT, input: { projectId } }],
    };
  }

  return { kind: 'none' };
}

function matchService(text: string): JarvisServiceId | undefined {
  const lowered = text.toLocaleLowerCase();
  const aliases = Object.entries(SERVICE_ALIASES).sort((left, right) => right[0].length - left[0].length);
  for (const [alias, id] of aliases) {
    if (/[A-Za-z]/.test(alias)) {
      if (new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'iu').test(text)) return id;
    } else if (lowered.includes(alias)) {
      return id;
    }
  }
  return undefined;
}

function matchSettings(text: string): string | undefined {
  const lowered = text.toLocaleLowerCase();
  const aliases: Array<[string, string]> = [
    ['windows update', 'windows-update'],
    ['windows-update', 'windows-update'],
    ['bluetooth', 'bluetooth'],
    ['บลูทูธ', 'bluetooth'],
    ['display settings', 'display'],
    ['ตั้งค่าจอ', 'display'],
    ['ตั้งค่าหน้าจอ', 'display'],
    ['sound', 'sound'],
    ['เสียง', 'sound'],
    ['network', 'network'],
    ['เครือข่าย', 'network'],
  ];
  for (const [alias, id] of aliases) {
    if (lowered.includes(alias)) return id;
  }
  return undefined;
}

function hasThai(text: string, keyword: string): boolean {
  return text.toLocaleLowerCase().includes(keyword.toLocaleLowerCase());
}

function matchApplication(text: string, allowedIds: string[]): string | undefined {
  const lowered = text.toLocaleLowerCase();
  const allowed = new Set(allowedIds);
  const aliases = Object.entries(APPLICATION_ALIASES)
    .sort((left, right) => right[0].length - left[0].length);
  for (const [alias, id] of aliases) {
    if (!allowed.has(id)) continue;
    if (lowered.includes(alias.toLocaleLowerCase())) return id;
  }
  return undefined;
}

function hasActionVerb(text: string, keywords: string[]): boolean {
  const lowered = text.toLocaleLowerCase();
  // เปิด contains ปิด as a substring; mask open-verbs before close-verb checks.
  const masked = lowered.replace(/เปิด/g, ' ');
  return keywords.some(keyword => {
    if (/[A-Za-z]/.test(keyword)) {
      return new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'iu').test(text);
    }
    const needle = keyword.toLocaleLowerCase();
    if (needle === 'ปิด') return masked.includes('ปิด');
    return lowered.includes(needle);
  });
}

function isConversationAboutBlockedTopic(text: string, reasonCode: string): boolean {
  const talking = /คืออะไร|ใช้ทำอะไร|ทำไม|อธิบาย|what is|what's|why (?:can'?t|cannot|doesn'?t)|explain/iu.test(text);
  if (!talking) return false;
  return reasonCode === 'BLOCKED_SHELL'
    || reasonCode === 'BLOCKED_SYSTEM_PATH'
    || reasonCode === 'BLOCKED_ARBITRARY_PATH'
    || reasonCode === 'BLOCKED_ARBITRARY_EXECUTABLE'
    || reasonCode === 'BLOCKED_GENERIC_PROCESS'
    || reasonCode === 'BLOCKED_REGISTRY';
}

function scopedOpenCall(resource: { kind: string; applicationId?: string; url?: string; label: string; display?: { raw: string; index?: number; role?: string; name?: string } | null }): CapabilityCall {
  return {
    id: DESKTOP_OPEN_SCOPED_RESOURCE,
    input: {
      kind: resource.kind,
      ...(resource.applicationId ? { applicationId: resource.applicationId } : {}),
      ...(resource.url ? { url: resource.url } : {}),
      label: resource.label,
      ...(resource.display ? { display: resource.display } : {}),
    },
  };
}

function leftoverIsNoise(text: string, matched: string): boolean {
  const aliases = [
    ...Object.entries(SERVICE_ALIASES).filter(([, id]) => id === matched).map(([alias]) => alias),
    ...Object.entries(APPLICATION_ALIASES).filter(([, id]) => id === matched).map(([alias]) => alias),
  ];
  let leftover = text;
  for (const token of [matched, ...aliases]) {
    leftover = leftover.replace(new RegExp(escapeRegExp(token), 'ig'), ' ');
  }
  leftover = leftover
    .replace(/jarvis/ig, ' ')
    .replace(/[?!.,]/g, ' ')
    .replace(/please|open|launch|start|stop|restart|status|system|project|folder|running|online|installed|install|battery|network|settings|bluetooth|display|sound|runtime|show|check|the|is|are|how|much|now|currently|help|can|you|for|me|see|if|okay|still|working/ig, ' ')
    .replace(/เปิด|ปิด|หยุด|เริ่ม|รีสตาร์ต|รีสตาร์ท|สถานะระบบ|สถานะ|โปรเจกต์|โฟลเดอร์|ครับ|นะ|หน่อย|ให้ที|ให้หน่อย|ให้แล้ว|ตอนนี้|เป็นยังไง|เป็นไง|ยังไง|อย่างไร|ไหม|ทำงาน|ออนไลน์|ติดตั้ง|มีอยู่|แบต|แบตเตอรี่|เน็ต|ต่อเน็ต|ตั้งค่า|ตัวนาย|ระบบ|เหลือ|เท่าไร|อยู่|เครื่อง|ใน|ปกติ|ช่วย|เข้า|เช็ก|เช็ค|ดู|บ้าง|ที/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return leftover.length === 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function blockedActionResult(reasonCode: string, userMessage: string) {
  return Object.freeze({
    name: 'system.unsupported',
    status: 'denied' as const,
    capabilityId: 'system.unsupported',
    summary: userMessage,
    risk: 'BLOCKED' as const,
    errorCode: reasonCode,
    detail: reasonCode,
  });
}

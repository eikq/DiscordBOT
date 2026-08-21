import { inferActionIntent } from '../capabilities/actions/actionIntent';
import {
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_PROJECT,
  DESKTOP_OPEN_SETTINGS,
  DESKTOP_OPEN_TRUSTED_URL,
  JARVIS_HEALTH_CHECK,
  JARVIS_RESTART_SERVICE,
  JARVIS_START_SERVICE,
  JARVIS_STOP_SERVICE,
} from '../capabilities/actions/constants';
import { SERVICE_ALIASES, type JarvisServiceId } from '../capabilities/actions/services/catalog';
import { RESEARCH_COMPARE, RESEARCH_CURRENT, RESEARCH_PRIVATE_BROWSE } from '../research/constants';
import { WORKSPACE_COMPARE, WORKSPACE_CURRENT, WORKSPACE_GET, WORKSPACE_SEARCH } from '../workspace/constants';
import { REMINDERS_CANCEL, REMINDERS_LIST, REMINDERS_RESCHEDULE } from '../automation/constants';
import { classifyActionability, isTalkingAboutTopic, shouldTreatAsForbiddenRequest } from './classify';
import { catalogHas } from './catalog';
import { newClarificationId } from './context';
import type { CompactCapability, IntentResolution, InteractionContext } from './types';

const SITE_URLS: Array<{ cues: string[]; url: string; label: string }> = [
  { cues: ['youtube', 'ยูทูบ', 'ยูทูป'], url: 'https://www.youtube.com', label: 'YouTube' },
  { cues: ['open.spotify.com', 'spotify web', 'เว็บ spotify'], url: 'https://open.spotify.com', label: 'Spotify Web' },
];

const APP_ALIASES: Array<{ cues: string[]; id: string }> = [
  { cues: ['chrome', 'โครม', 'กูเกิลโครม'], id: 'chrome' },
  { cues: ['เบราว์เซอร์', 'บราวเซอร์', 'browser'], id: 'browser' },
  { cues: ['notepad', 'โน้ตแพด', 'โน๊ตแพด'], id: 'notepad' },
  { cues: ['spotify', 'สปอติฟาย'], id: 'spotify' },
  { cues: ['edge', 'msedge'], id: 'msedge' },
  { cues: ['calculator', 'เครื่องคิดเลข', 'calc'], id: 'calculator' },
  { cues: ['cursor'], id: 'cursor' },
];

export function heuristicResolve(
  text: string,
  options: {
    catalog: CompactCapability[];
    applicationIds?: string[];
    projectIds?: string[];
    context?: InteractionContext | null;
    now?: number;
  },
): IntentResolution | null {
  const raw = text.trim();
  const actionClass = classifyActionability(raw);
  if (shouldTreatAsForbiddenRequest(raw)) {
    return forbidden('FORBIDDEN_REQUEST', 'ทำรายการนี้ไม่ได้ครับ');
  }

  const fromClarification = resolveClarificationAnswer(raw, options.context, options.catalog);
  if (fromClarification) return fromClarification;

  const followUp = resolveFollowUp(raw, options.context, options.catalog);
  if (followUp) return followUp;

  const site = matchSite(raw);
  if (site && catalogHas(options.catalog, DESKTOP_OPEN_TRUSTED_URL) && wantsOpen(raw)) {
    return capability(DESKTOP_OPEN_TRUSTED_URL, { url: site.url }, 'HEURISTIC_URL', 'HIGH', true);
  }

  if (isVagueTask(raw)) {
    return clarification(raw, 'ต้องการให้ช่วยเรื่องอะไรครับ?', [], 'AMBIGUOUS_TASK');
  }

  if (isSpotifyVague(raw)) {
    return clarification(raw, 'ต้องการให้เปิดแอป Spotify เช็กว่าติดตั้งแล้ว หรือเปิดเว็บ Spotify ครับ?', [
      { capabilityId: DESKTOP_OPEN_APPLICATION, arguments: { applicationId: 'spotify' }, label: 'เปิดแอป Spotify' },
      { capabilityId: DESKTOP_OPEN_TRUSTED_URL, arguments: { url: 'https://open.spotify.com' }, label: 'เปิดเว็บ Spotify' },
    ].filter(item => catalogHas(options.catalog, item.capabilityId)), 'AMBIGUOUS_SPOTIFY');
  }

  if (isAsrManage(raw)) {
    return clarification(raw, 'ต้องการให้ผมเช็กสถานะ ASR หรือรีสตาร์ตมันครับ?', [
      { capabilityId: JARVIS_HEALTH_CHECK, arguments: { serviceId: 'qwen-asr' }, label: 'เช็กสถานะ ASR' },
      { capabilityId: JARVIS_RESTART_SERVICE, arguments: { serviceId: 'qwen-asr' }, label: 'รีสตาร์ต ASR' },
    ].filter(item => catalogHas(options.catalog, item.capabilityId)), 'AMBIGUOUS_ASR');
  }

  if (isSoundStack(raw) && !matchService(raw)) {
    return clarification(raw, 'หมายถึงสถานะ ASR/TTS หรือจะให้เปิดหน้า Sound Settings ครับ?', [
      { capabilityId: JARVIS_HEALTH_CHECK, arguments: { serviceId: 'qwen-asr' }, label: 'เช็ก ASR' },
      { capabilityId: DESKTOP_OPEN_SETTINGS, arguments: { settingsId: 'sound' }, label: 'เปิด Sound Settings' },
    ].filter(item => catalogHas(options.catalog, item.capabilityId)), 'AMBIGUOUS_SOUND');
  }

  if (isVolumeAdjust(raw)) {
    const candidates = [
      { capabilityId: DESKTOP_OPEN_SETTINGS, arguments: { settingsId: 'sound' }, label: 'เปิด Sound Settings' },
    ].filter(item => catalogHas(options.catalog, item.capabilityId));
    return {
      ...clarification(raw, 'ตอนนี้ผมยังไม่มี capability สำหรับปรับระดับเสียงโดยตรง แต่ผมเปิดหน้า Sound Settings ให้คุณได้ ต้องการให้เปิดไหม?', candidates, 'UNSUPPORTED_VOLUME'),
      kind: 'UNSUPPORTED',
      alternatives: candidates,
      actionClass: 'ACTIONABLE',
    };
  }

  if (isJarvisFile(raw)) {
    return clarification(raw, 'หมายถึงค้นไฟล์ในโปรเจกต์ หรือเปิดโฟลเดอร์โปรเจกต์ Jarvis ครับ?', [
      { capabilityId: WORKSPACE_SEARCH, arguments: { query: 'Jarvis' }, label: 'ค้นไฟล์ในโปรเจกต์ Jarvis' },
      { capabilityId: DESKTOP_OPEN_PROJECT, arguments: { projectId: options.projectIds?.[0] || 'jarvis-project' }, label: 'เปิดโฟลเดอร์โปรเจกต์ Jarvis' },
    ].filter(item => catalogHas(options.catalog, item.capabilityId)), 'AMBIGUOUS_PROJECT');
  }

  if (isDanglingPronoun(raw) && !options.context) {
    return clarification(raw, 'หมายถึงรายการไหนครับ?', [], 'AMBIGUOUS_REFERENT');
  }

  const service = matchService(raw);
  if (service && catalogHas(options.catalog, JARVIS_HEALTH_CHECK) && wantsStatus(raw) && !wantsStart(raw) && !wantsRestart(raw) && !wantsStop(raw)) {
    return capability(JARVIS_HEALTH_CHECK, { serviceId: service }, 'HEURISTIC_SERVICE_STATUS', 'HIGH', true);
  }

  const app = matchApp(raw, options.applicationIds);
  if (app && catalogHas(options.catalog, DESKTOP_OPEN_APPLICATION) && wantsOpen(raw)) {
    const resolution = capability(DESKTOP_OPEN_APPLICATION, { applicationId: app }, 'HEURISTIC_OPEN_APP', 'HIGH', true);
    if (app === 'spotify') {
      resolution.alternatives = catalogHas(options.catalog, DESKTOP_OPEN_TRUSTED_URL)
        ? [{ capabilityId: DESKTOP_OPEN_TRUSTED_URL, arguments: { url: 'https://open.spotify.com' }, label: 'เปิดเว็บ Spotify แทน' }]
        : [];
    }
    return resolution;
  }

  if (wantsPrivateBrowse(raw) && catalogHas(options.catalog, RESEARCH_PRIVATE_BROWSE)) {
    const url = raw.match(/https?:\/\/[^\s]+/iu)?.[0];
    const query = extractResearchQuery(raw.replace(/https?:\/\/[^\s]+/giu, '').replace(/แบบส่วนตัว|private browser|whonix|ทอร์/giu, ''));
    if (!url && !query) {
      return clarification(raw, 'ให้เปิด URL ไหนใน private browser ครับ?', [], 'AMBIGUOUS_PRIVATE_BROWSER');
    }
    return capability(RESEARCH_PRIVATE_BROWSE, {
      ...(url ? { url } : {}),
      ...(query ? { query } : {}),
      depth: /forensic|เชิงลึกมาก/iu.test(raw) ? 'forensic' : /deep|เชิงลึก/iu.test(raw) ? 'deep' : 'standard',
    }, 'HEURISTIC_PRIVATE_BROWSER', 'HIGH', true);
  }

  if (wantsResearch(raw)) {
    const query = extractResearchQuery(raw);
    if (!query) {
      return clarification(raw, 'ให้ค้นเรื่องอะไรครับ?', [], 'AMBIGUOUS_RESEARCH');
    }
    return capability(RESEARCH_CURRENT, {
      query,
      officialOnly: /ทางการ|official|nvidia โดยตรง|เว็บทางการ/iu.test(raw),
      freshness: /ล่าสุด|วันนี้|ตอนนี้|latest|current|ราคา/iu.test(raw) ? 'latest' : 'any',
      compare: /เทียบ|compare/iu.test(raw),
    }, 'HEURISTIC_RESEARCH', 'HIGH', true);
  }

  if (actionClass === 'CONVERSATION' && !looksActionable(raw)) {
    return conversation(raw);
  }
  return null;
}

export function fastPathResolution(
  text: string,
  options: { applicationIds?: string[]; projectIds?: string[]; catalog: CompactCapability[] },
): IntentResolution | null {
  const intent = inferActionIntent(text, {
    applicationIds: options.applicationIds,
    projectIds: options.projectIds,
  });
  if (intent.kind === 'unsupported') {
    return {
      kind: 'UNSUPPORTED',
      confidence: 'HIGH',
      reasonCode: intent.reasonCode,
      userMessage: intent.userMessage,
      consumed: true,
      source: 'fast-path',
      actionClass: 'ACTIONABLE',
    };
  }
  if (intent.kind === 'blocked') {
    return {
      kind: 'FORBIDDEN',
      confidence: 'HIGH',
      reasonCode: intent.reasonCode,
      userMessage: intent.userMessage,
      consumed: true,
      source: 'fast-path',
      actionClass: 'FORBIDDEN',
    };
  }
  if (intent.kind === 'action') {
    const call = intent.calls[0];
    if (!call || !catalogHas(options.catalog, call.id)) return null;
    const resolution: IntentResolution = {
      kind: 'CAPABILITY',
      capabilityId: call.id,
      arguments: call.input ?? {},
      confidence: 'HIGH',
      reasonCode: 'FAST_PATH',
      consumed: intent.consumed,
      source: 'fast-path',
      actionClass: classifyActionability(text) === 'FORBIDDEN' ? 'ACTIONABLE' : classifyActionability(text) === 'CONVERSATION' ? 'ACTIONABLE' : classifyActionability(text),
    };
    if (call.id === DESKTOP_OPEN_APPLICATION && call.input?.applicationId === 'spotify' && catalogHas(options.catalog, DESKTOP_OPEN_TRUSTED_URL)) {
      resolution.alternatives = [{
        capabilityId: DESKTOP_OPEN_TRUSTED_URL,
        arguments: { url: 'https://open.spotify.com' },
        label: 'เปิดเว็บ Spotify แทน',
      }];
    }
    return resolution;
  }
  return null;
}

function resolveClarificationAnswer(
  text: string,
  context: InteractionContext | null | undefined,
  catalog: CompactCapability[],
): IntentResolution | null {
  const pending = context?.pendingClarification;
  if (!pending || pending.expiresAt <= Date.now()) return null;
  const lowered = text.toLocaleLowerCase();
  if (/ไม่|no|cancel|ยกเลิก/iu.test(lowered) && pending.candidateIntents.length > 1) {
    return conversation(text);
  }
  const picked = pending.candidateIntents.find((item, index) => {
    const labels = [item.label, String(index + 1), item.capabilityId, ...Object.values(item.arguments ?? {})].map(value => String(value).toLocaleLowerCase());
    return labels.some(label => label && lowered.includes(label))
      || (index === 0 && /เช็ก|เช็ค|สถานะ|check|status|แรก/iu.test(lowered))
      || (index === 1 && /รีสตาร์ต|restart|เว็บ|web|สอง/iu.test(lowered));
  });
  if (!picked) {
    if (pending.candidateIntents.length === 1 && /ใช่|ได้|เลย|yes|ok|เปิด/iu.test(lowered)) {
      const only = pending.candidateIntents[0];
      if (catalogHas(catalog, only.capabilityId)) {
        return capability(only.capabilityId, only.arguments ?? {}, 'CLARIFICATION_RESOLVED', 'HIGH', true, 'context');
      }
    }
    return null;
  }
  if (!catalogHas(catalog, picked.capabilityId)) return null;
  return capability(picked.capabilityId, picked.arguments ?? {}, 'CLARIFICATION_RESOLVED', 'HIGH', true, 'context');
}

function resolveFollowUp(
  text: string,
  context: InteractionContext | null | undefined,
  catalog: CompactCapability[],
): IntentResolution | null {
  if (!context) return null;
  const raw = text.trim();
  if (context.recentResearchQuery && /เอาเฉพาะ|ทางการ|official|nvidia โดยตรง/iu.test(raw) && catalogHas(catalog, RESEARCH_CURRENT)) {
    return capability(RESEARCH_CURRENT, {
      query: context.recentResearchQuery,
      officialOnly: true,
      freshness: 'latest',
      reuseLast: true,
    }, 'CONTEXT_RESEARCH_OFFICIAL', 'HIGH', true, 'context');
  }
  if (context.lastCapabilityId?.startsWith('research.') && /เทียบ|compare|สองอันแรก/iu.test(raw) && catalogHas(catalog, RESEARCH_COMPARE)) {
    return capability(RESEARCH_COMPARE, { sourceIds: [] }, 'CONTEXT_RESEARCH_COMPARE', 'HIGH', true, 'context');
  }
  if (context.lastCapabilityId?.startsWith('research.') && /เก่าแค่ไหน|ล่าสุดเมื่อ|how recent/iu.test(raw) && catalogHas(catalog, RESEARCH_CURRENT)) {
    return capability(RESEARCH_CURRENT, {
      query: context.recentResearchQuery || raw,
      freshness: 'latest',
      reuseLast: true,
    }, 'CONTEXT_RESEARCH_FRESHNESS', 'HIGH', true, 'context');
  }
  if (context.lastServiceId && /รีสตาร์ตมัน|restart it/iu.test(raw) && catalogHas(catalog, JARVIS_RESTART_SERVICE)) {
    return capability(JARVIS_RESTART_SERVICE, { serviceId: context.lastServiceId }, 'CONTEXT_RESTART', 'HIGH', true, 'context');
  }
  if (context.lastServiceId && /เริ่มมัน|start it/iu.test(raw) && catalogHas(catalog, JARVIS_START_SERVICE)) {
    return capability(JARVIS_START_SERVICE, { serviceId: context.lastServiceId }, 'CONTEXT_START', 'HIGH', true, 'context');
  }
  if (context.lastServiceId && /หยุดมัน|ปิดมัน|stop it/iu.test(raw) && catalogHas(catalog, JARVIS_STOP_SERVICE)) {
    return capability(JARVIS_STOP_SERVICE, { serviceId: context.lastServiceId }, 'CONTEXT_STOP', 'HIGH', true, 'context');
  }
  if (context.recentReminderIds?.length && /ยกเลิกอันแรก|cancel the first/iu.test(raw) && catalogHas(catalog, REMINDERS_CANCEL)) {
    return capability(REMINDERS_CANCEL, { reminderId: context.recentReminderIds[0] }, 'CONTEXT_REMINDER_CANCEL', 'HIGH', true, 'context');
  }
  if (context.recentReminderIds?.length && /เลื่อนอันแรก|postpone the first|snooze the first/iu.test(raw) && catalogHas(catalog, REMINDERS_RESCHEDULE)) {
    return capability(REMINDERS_RESCHEDULE, { reminderId: context.recentReminderIds[0], whenText: raw }, 'CONTEXT_REMINDER_RESCHEDULE', 'HIGH', true, 'context');
  }
  if (context.lastCapabilityId?.startsWith('workspace.') && /ต่างจาก.*เว็บ|ข้อมูลบนเว็บ|from the web/iu.test(raw) && catalogHas(catalog, WORKSPACE_CURRENT)) {
    return capability(WORKSPACE_CURRENT, {
      query: context.recentDocumentQuery || raw,
      reuseLast: true,
      hybridWeb: true,
    }, 'CONTEXT_WORKSPACE_HYBRID', 'HIGH', true, 'context');
  }
  if (context.recentDocumentIds?.length && /สรุปอันนี้|สรุปไฟล์นี้|this file|the current file/iu.test(raw) && catalogHas(catalog, WORKSPACE_CURRENT)) {
    return capability(WORKSPACE_CURRENT, {
      documentId: context.recentDocumentIds[0],
      mode: 'summarize',
      reuseLast: true,
    }, 'CONTEXT_WORKSPACE_SUMMARIZE', 'HIGH', true, 'context');
  }
  if (context.recentDocumentIds && context.recentDocumentIds.length >= 2 && /อันแรกต่างจากอันที่สอง|แรก.*สอง/iu.test(raw) && catalogHas(catalog, WORKSPACE_COMPARE)) {
    return capability(WORKSPACE_COMPARE, {
      documentIds: context.recentDocumentIds.slice(0, 2),
    }, 'CONTEXT_WORKSPACE_COMPARE', 'HIGH', true, 'context');
  }
  if (context.lastCapabilityId?.startsWith('workspace.') && /เทียบกับ/iu.test(raw) && catalogHas(catalog, WORKSPACE_COMPARE)) {
    return capability(WORKSPACE_COMPARE, {
      documentIds: context.recentDocumentIds?.slice(0, 1),
      rightQuery: raw.replace(/เทียบกับ/iu, '').trim(),
    }, 'CONTEXT_WORKSPACE_COMPARE_ONE', 'HIGH', true, 'context');
  }
  if (context.recentDocumentIds?.length === 1 && /เปิดอันแรก|เปิดอันนั้น|เปิดไฟล์นั้น|the first|that file/iu.test(raw) && catalogHas(catalog, WORKSPACE_GET)) {
    return capability(WORKSPACE_GET, { documentId: context.recentDocumentIds[0] }, 'CONTEXT_WORKSPACE_OPEN', 'HIGH', true, 'context');
  }
  if (context.recentDocumentIds && context.recentDocumentIds.length > 1 && /เปิดอันแรก|the first/iu.test(raw) && catalogHas(catalog, WORKSPACE_GET)) {
    return capability(WORKSPACE_GET, { documentId: context.recentDocumentIds[0] }, 'CONTEXT_WORKSPACE_FIRST', 'HIGH', true, 'context');
  }
  if (context.recentDocumentIds && context.recentDocumentIds.length > 1 && /เปิดอันนั้น|open that/iu.test(raw)) {
    return clarification(raw, 'หมายถึงไฟล์ไหนครับ?', context.recentDocumentIds.slice(0, 4).map((documentId, index) => ({
      capabilityId: WORKSPACE_GET,
      arguments: { documentId },
      label: `ไฟล์ที่ ${index + 1}`,
    })), 'AMBIGUOUS_DOCUMENT');
  }
  if (context.lastCapabilityId === REMINDERS_LIST && /อันแรก/iu.test(raw)) {
    return clarification(raw, 'ให้ยกเลิกหรือเลื่อน reminder อันแรกครับ?', [
      { capabilityId: REMINDERS_CANCEL, arguments: { reminderId: context.recentReminderIds?.[0] }, label: 'ยกเลิกอันแรก' },
      { capabilityId: REMINDERS_RESCHEDULE, arguments: { reminderId: context.recentReminderIds?.[0], whenText: raw }, label: 'เลื่อนอันแรก' },
    ].filter(item => catalogHas(catalog, item.capabilityId) && item.arguments?.reminderId), 'AMBIGUOUS_REMINDER');
  }
  return null;
}

function wantsOpen(text: string): boolean {
  return /เปิด|เข้า|launch|open|start|ช่วยเปิด|เปิดเว็บ/iu.test(text);
}

function wantsStatus(text: string): boolean {
  return /เป็นไง|เป็นยังไง|ทำงาน|ออนไลน์|เช็ก|เช็ค|ดู|check|status|okay|ok\b|reachable|ยัง/iu.test(text);
}

function wantsStart(text: string): boolean {
  return /เริ่ม|start/iu.test(text) && !/รีสตาร์ต|restart/iu.test(text);
}

function wantsRestart(text: string): boolean {
  return /รีสตาร์ต|รีสตาร์ท|restart/iu.test(text);
}

function wantsStop(text: string): boolean {
  return /หยุด|ปิด|stop/iu.test(text) && !/เปิด/iu.test(text);
}

function wantsPrivateBrowse(text: string): boolean {
  return /private browser|whonix|ทอร์\b|tor browser|แบบส่วนตัว|private research/iu.test(text)
    && !isTalkingAboutTopic(text);
}

function wantsResearch(text: string): boolean {
  return /เช็คราคา|เช็กราคา|ราคาล่าสุด|ลองดูว่า|ช่วยหา|ดูข่าว|หาอะไรเกี่ยวกับ|find out|look into|look up|can you check|prices?|ข่าว|ล่าสุด|ค้น/iu.test(text)
    && !isTalkingAboutTopic(text)
    && !matchService(text);
}

function extractResearchQuery(text: string): string {
  return text
    .replace(/jarvis|please|ช่วย|ให้หน่อย|หน่อย|ครับ|นะ|ที|ตอนนี้|ล่าสุด|วันนี้|เช็คราคา|เช็กราคา|เช็ค|เช็ก|ลองดูว่า|ช่วยหา|ดูข่าว|หาอะไรเกี่ยวกับ|find out|look into|look up|can you check|prices?|เท่าไร|เท่าไหร่|about|regarding|\bthis\b|\bthat\b|\bit\b|can you/giu, ' ')
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isVagueTask(text: string): boolean {
  return /^(ช่วยทำหน่อย|ช่วยด้วย|ทำหน่อย|help me|can you help)$/iu.test(text.trim());
}

function isSpotifyVague(text: string): boolean {
  return /spotify|สปอติฟาย/iu.test(text) && /ช่วยทำ|จัดการ|ทำอะไรกับ/iu.test(text);
}

function isAsrManage(text: string): boolean {
  return /\basr\b|qwen-asr/iu.test(text) && /จัดการ|handle|ทำอะไรกับ/iu.test(text);
}

function isSoundStack(text: string): boolean {
  return /ระบบเสียง|voice stack|voice system/iu.test(text);
}

function isVolumeAdjust(text: string): boolean {
  return /ปรับระดับเสียง|volume (?:up|down)|ลดเสียง|เพิ่มเสียง|ตั้งระดับเสียง/iu.test(text);
}

function isJarvisFile(text: string): boolean {
  return /เปิดไฟล์|open (?:the )?file|ไฟล์ jarvis/iu.test(text);
}

function isDanglingPronoun(text: string): boolean {
  return /^(เปิดอันนั้น|รีสตาร์ตมัน|หาอันนี้ให้หน่อย|restart it|open that)$/iu.test(text.trim());
}

function looksActionable(text: string): boolean {
  return wantsOpen(text) || wantsResearch(text) || wantsStatus(text);
}

function matchSite(text: string): { url: string; label: string } | undefined {
  const lowered = text.toLocaleLowerCase();
  return SITE_URLS.find(site => site.cues.some(cue => lowered.includes(cue)));
}

function matchApp(text: string, allowed?: string[]): string | undefined {
  const lowered = text.toLocaleLowerCase();
  const allowedSet = new Set(allowed ?? APP_ALIASES.map(item => item.id));
  const hit = APP_ALIASES.find(item => allowedSet.has(item.id) && item.cues.some(cue => lowered.includes(cue)));
  return hit?.id;
}

function matchService(text: string): JarvisServiceId | undefined {
  const lowered = text.toLocaleLowerCase();
  const aliases = Object.entries(SERVICE_ALIASES).sort((left, right) => right[0].length - left[0].length);
  for (const [alias, id] of aliases) {
    if (/[A-Za-z]/.test(alias)) {
      if (new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu').test(text)) return id;
    } else if (lowered.includes(alias)) {
      return id;
    }
  }
  return undefined;
}

function capability(
  capabilityId: string,
  args: Record<string, unknown>,
  reasonCode: string,
  confidence: IntentResolution['confidence'],
  consumed: boolean,
  source: IntentResolution['source'] = 'heuristic',
): IntentResolution {
  return {
    kind: 'CAPABILITY',
    capabilityId,
    arguments: args,
    confidence,
    reasonCode,
    consumed,
    source,
    actionClass: 'ACTIONABLE',
  };
}

function clarification(
  _text: string,
  question: string,
  candidateIntents: NonNullable<IntentResolution['clarification']>['candidateIntents'],
  reasonCode: string,
): IntentResolution {
  const now = Date.now();
  return {
    kind: 'CLARIFICATION',
    confidence: 'MEDIUM',
    reasonCode,
    userMessage: question,
    consumed: true,
    source: 'heuristic',
    actionClass: 'AMBIGUOUS',
    clarification: {
      clarificationId: newClarificationId(now),
      originalRequestId: `req_${now.toString(16)}`,
      question,
      candidateIntents,
      expiresAt: now + 10 * 60_000,
    },
  };
}

function conversation(text: string): IntentResolution {
  return {
    kind: 'CONVERSATION',
    confidence: 'HIGH',
    reasonCode: isTalkingAboutTopic(text) ? 'CONVERSATION_ABOUT_TOPIC' : 'CONVERSATION',
    consumed: false,
    source: 'heuristic',
    actionClass: 'CONVERSATION',
  };
}

function forbidden(reasonCode: string, userMessage: string): IntentResolution {
  return {
    kind: 'FORBIDDEN',
    confidence: 'HIGH',
    reasonCode,
    userMessage,
    consumed: true,
    source: 'heuristic',
    actionClass: 'FORBIDDEN',
  };
}

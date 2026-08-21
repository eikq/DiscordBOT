/**
 * Voice / intent families. Cue clusters extract slots.
 * Not a phrase switch — many wordings map to the same structured goal.
 */

import { parseDisplaySelector, type DisplaySelector } from '../desktop/monitorTopology';

function stripAddress(text: string): string {
  return text
    .replace(/^\s*((?:hey\s+)?jarvis[,.!?]*\s*|จาร์วิส[,.!?]*\s*)+/iu, '')
    .replace(/^[.!?,\s]+|[.!?,\s]+$/gu, '')
    .trim();
}

export const VOICE_FAMILIES = [
  'WAKE',
  'CONVERSATION_STATUS',
  'SELF_KNOWLEDGE',
  'SELF_GAP',
  'SYSTEM_STATUS',
  'DESKTOP_OPEN',
  'DESKTOP_PLACE',
  'DESKTOP_FOCUS',
  'RESEARCH',
  'RESEARCH_FOLLOWUP',
  'WORKSPACE',
  'TASK_STATUS',
  'CANCEL_TASK',
  'EMERGENCY_STOP',
  'PERMISSION_ALLOW',
  'PERMISSION_DENY',
  'REMINDER',
  'SPEECH_CONTROL',
  'SPEECH_MODE',
  'PRESENCE_UI',
  'VISUAL_INSPECT',
  'UNSUPPORTED_COMPUTER_USE',
  'MEDIA_UNSUPPORTED',
  'CCTV_PREPARE',
  'COMPOUND_OPEN',
  'WORK_CONTINUE',
  'CORRECTION',
  'MEMORY',
  'UNKNOWN',
] as const;

export type VoiceFamily = (typeof VOICE_FAMILIES)[number];

export type VoiceResource = {
  kind: 'application' | 'url';
  applicationId?: string;
  url?: string;
  label: string;
  display?: DisplaySelector | null;
};

export type VoiceSlots = {
  family: VoiceFamily;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  resources: VoiceResource[];
  display?: DisplaySelector | null;
  query?: string;
  officialOnly?: boolean;
  researchDepth?: 'quick' | 'standard' | 'deep' | 'forensic';
  mutating: boolean;
};

const APP_CUES: Array<{ cues: string[]; id: string; label: string }> = [
  { cues: ['cursor'], id: 'cursor', label: 'Cursor' },
  { cues: ['vscode', 'vs code', 'visual studio code'], id: 'vscode', label: 'VS Code' },
  { cues: ['file explorer', 'explorer', 'file explorer', 'explorer.exe'], id: 'explorer', label: 'File Explorer' },
  { cues: ['browser', 'เบราว์เซอร์', 'บราวเซอร์', 'chrome', 'โครม', 'edge'], id: 'browser', label: 'browser' },
  { cues: ['discord'], id: 'discord', label: 'Discord' },
  { cues: ['notepad', 'โน้ตแพด', 'โน๊ตแพด'], id: 'notepad', label: 'Notepad' },
  { cues: ['spotify', 'สปอติฟาย'], id: 'spotify', label: 'Spotify' },
];

const SITE_CUES: Array<{ cues: string[]; url: string; label: string }> = [
  { cues: ['youtube', 'ยูทูบ', 'ยูทูป', 'youtu.be', 'youtube.com'], url: 'https://www.youtube.com', label: 'YouTube' },
];

export function classifyVoiceFamily(text: string): VoiceSlots {
  const addressed = stripAddress(text);
  const raw = addressed.trim();
  if (!raw || isWakeOnly(text, raw)) {
    return slots('WAKE', 'HIGH', { mutating: false });
  }
  if (isEmergency(raw)) return slots('EMERGENCY_STOP', 'HIGH', { mutating: false });
  if (isComputerUse(raw)) return slots('UNSUPPORTED_COMPUTER_USE', 'HIGH', { mutating: true });
  if (isMediaUnsupported(raw)) return slots('MEDIA_UNSUPPORTED', 'HIGH', { mutating: true });
  if (isCctv(raw)) return slots('CCTV_PREPARE', 'HIGH', { mutating: false, query: raw });
  if (isPermissionAllow(raw)) return slots('PERMISSION_ALLOW', 'HIGH', { mutating: false });
  if (isPermissionDeny(raw)) return slots('PERMISSION_DENY', 'HIGH', { mutating: false });
  if (isCorrection(raw)) return slots('CORRECTION', 'HIGH', { mutating: true, display: parseDisplaySelector(raw), resources: extractResources(raw) });
  if (isSpeechMode(raw)) return slots('SPEECH_MODE', 'HIGH', { mutating: false });
  if (isSpeechControl(raw)) return slots('SPEECH_CONTROL', 'HIGH', { mutating: false });
  if (isPresenceUi(raw)) return slots('PRESENCE_UI', 'HIGH', { mutating: false });
  if (isVisualInspect(raw)) return slots('VISUAL_INSPECT', 'HIGH', { mutating: false });
  if (isWorkContinue(raw)) return slots('WORK_CONTINUE', 'HIGH', { mutating: false });
  if (isCancelTask(raw)) return slots('CANCEL_TASK', 'HIGH', { mutating: false });
  if (isTaskStatus(raw)) return slots('TASK_STATUS', 'HIGH', { mutating: false });
  if (isMemory(raw)) return slots('MEMORY', 'HIGH', { mutating: /remember|forget|จำไว้|ลืม/iu.test(raw) });
  if (isReminder(raw)) return slots('REMINDER', 'HIGH', { mutating: true, query: raw });
  if (isSelfGap(raw)) return slots('SELF_GAP', 'HIGH', { mutating: false });
  if (isSelfKnowledge(raw)) return slots('SELF_KNOWLEDGE', 'HIGH', { mutating: false });
  if (isSystemStatus(raw)) return slots('SYSTEM_STATUS', 'HIGH', { mutating: false });
  if (isConversationStatus(raw)) return slots('CONVERSATION_STATUS', 'HIGH', { mutating: false });
  if (isResearchFollowup(raw)) return slots('RESEARCH_FOLLOWUP', 'HIGH', { mutating: false, query: raw });
  if (isWorkspace(raw)) return slots('WORKSPACE', 'HIGH', { mutating: /fix|แก้|build|patch/iu.test(raw), query: extractAfter(raw) });
  if (isResearch(raw)) {
    return slots('RESEARCH', 'HIGH', {
      mutating: false,
      query: extractResearchQuery(raw),
      officialOnly: /official|ทางการ/iu.test(raw),
      researchDepth: /forensic|ละเอียดที่สุด/iu.test(raw) ? 'forensic' : /deep|ลึก/iu.test(raw) ? 'deep' : /quick|เร็ว/iu.test(raw) ? 'quick' : 'standard',
    });
  }

  const resources = assignDisplaysToResources(raw, extractResources(raw));
  const display = resources.find(item => item.display)?.display ?? parseDisplaySelector(raw);
  if (resources.length >= 2 && wantsOpen(raw)) {
    return { family: 'COMPOUND_OPEN', confidence: 'HIGH', resources, display, mutating: true };
  }
  if (resources.length === 1 && wantsPlace(raw)) {
    return { family: 'DESKTOP_PLACE', confidence: 'HIGH', resources, display, mutating: true };
  }
  if (resources.length === 1 && wantsFocus(raw)) {
    return { family: 'DESKTOP_FOCUS', confidence: 'HIGH', resources, display, mutating: true };
  }
  if (resources.length === 1 && wantsOpen(raw)) {
    return { family: 'DESKTOP_OPEN', confidence: 'HIGH', resources, display, mutating: true };
  }
  return slots('UNKNOWN', 'LOW', { mutating: false, query: raw });
}

export function extractResources(text: string): VoiceResource[] {
  const lowered = text.toLocaleLowerCase();
  const found: Array<VoiceResource & { index: number }> = [];
  for (const site of SITE_CUES) {
    const index = firstCueIndex(lowered, site.cues);
    if (index >= 0 && !found.some(item => item.label === site.label)) {
      found.push({ kind: 'url', url: site.url, label: site.label, index });
    }
  }
  for (const app of APP_CUES) {
    const index = firstCueIndex(lowered, app.cues);
    if (index >= 0 && !found.some(item => item.applicationId === app.id)) {
      found.push({ kind: 'application', applicationId: app.id, label: app.label, index });
    }
  }
  const urlMatch = text.match(/https?:\/\/[^\s]+/iu);
  if (urlMatch?.[0] && !found.some(item => item.url === urlMatch[0])) {
    found.push({ kind: 'url', url: urlMatch[0], label: urlMatch[0], index: urlMatch.index ?? 0 });
  }
  return found.sort((left, right) => left.index - right.index).map(({ index: _index, ...resource }) => resource);
}

export function assignDisplaysToResources(text: string, resources: VoiceResource[]): VoiceResource[] {
  if (resources.length === 0) return resources;
  const parts = text.split(/\s+(?:and|แล้ว|และ)\s+/iu).map(part => part.trim()).filter(Boolean);
  if (resources.length === 1 || parts.length < 2) {
    const display = parseDisplaySelector(text);
    return resources.map(resource => (display ? { ...resource, display } : resource));
  }
  return resources.map(resource => {
    const part = parts.find(item => extractResources(item).some(hit => sameResource(hit, resource)));
    const display = part ? parseDisplaySelector(part) : null;
    return display ? { ...resource, display } : resource;
  });
}

function slots(family: VoiceFamily, confidence: VoiceSlots['confidence'], extra: Partial<VoiceSlots>): VoiceSlots {
  return {
    family,
    confidence,
    resources: extra.resources ?? [],
    display: extra.display,
    query: extra.query,
    officialOnly: extra.officialOnly,
    researchDepth: extra.researchDepth,
    mutating: extra.mutating ?? false,
  };
}

function isWakeOnly(original: string, stripped: string): boolean {
  if (!stripped) return /jarvis|จาร์วิส/iu.test(original);
  return /^(are you there|you there|อยู่ไหม|อยู่ไหมครับ)$/iu.test(stripped);
}

function isEmergency(text: string): boolean {
  return /emergency stop|halt everything|stop everything now|หยุดฉุกเฉิน|หยุดทุกอย่างเดี๋ยวนี้/iu.test(text);
}

function isComputerUse(text: string): boolean {
  return /\b(click that|type this|submit the form|drag that|fill this in|คลิกอันนั้น|พิมพ์อันนี้|ส่งฟอร์ม)\b/iu.test(text);
}

function isMediaUnsupported(text: string): boolean {
  return /play the (?:video|first result)|stop the video|turn it up|lower the volume|search youtube for|upload this video|publish this video|เล่นวิดีโอ|ค้น youtube|อัปโหลด/iu.test(text)
    && !wantsOpen(text);
}

function isCorrection(text: string): boolean {
  return /no, (?:the other|i meant|use)|i meant|actually (?:make it|change)|use official sources only|don't open it yet|ไม่ใช่จอ|หมายถึง|จริงๆ (?:เปลี่ยน|ให้)|ใช้เฉพาะ official|ยังไม่ต้องเปิด/iu.test(text)
    && !/^(no|ไม่)$/iu.test(text);
}

function isWorkContinue(text: string): boolean {
  return /try another safe approach|keep going until|finish this task|resume the task|continue that task|ทำต่อให้เสร็จ|ลองวิธีอื่น|ทำงานเดิมต่อ/iu.test(text)
    || /^(continue|resume|ทำต่อ)$/iu.test(text);
}

function isMemory(text: string): boolean {
  return /what do you remember|have we done this before|what happened last time|remember this preference|forget that|จำเรื่องนี้|เราเคยทำ|ครั้งก่อนเกิดอะไร|จำไว้ว่า|ลืมเรื่องนี้/iu.test(text);
}

function isCctv(text: string): boolean {
  return /\b(cctv|nvr|camera|กล้อง|ชั้น\s*\d|rooftop|ดาดฟ้า)\b/iu.test(text)
    && /show|check|open|look|ดู|เปิด|มีอะไร/iu.test(text);
}

function isPermissionAllow(text: string): boolean {
  return /^(yes|y|ok|okay|allow|allow once|proceed|do it|go ahead|approved|ใช่|ทำเลย|อนุญาต|อนุญาตครั้งนี้|ดำเนินการ|โอเค ทำต่อ)$/iu.test(text);
}

function isPermissionDeny(text: string): boolean {
  return /^(no|n|deny|don't|dont|cancel it|ไม่|ไม่อนุญาต|ยกเลิก)$/iu.test(text);
}

function isSpeechMode(text: string): boolean {
  return /only speak when you need me|keep me updated|don't narrate|important updates only|stay quiet while researching|read the final result|พูดเฉพาะ|คอยอัปเดต|ไม่ต้องพูดทุกขั้น|บอกเฉพาะเรื่องสำคัญ|ตอน research ไม่ต้องพูด|เสร็จแล้วอ่าน/iu.test(text);
}

function isSpeechControl(text: string): boolean {
  return /stop talking|be quiet|shut up|continue speaking|say that again|repeat that|speak slower|speak faster|speak more naturally|speak thai|speak english|keep the answer short|explain it in detail|read that aloud|don't read the sources|หยุดพูด|เงียบก่อน|พูดต่อ|พูดอีกที|พูดช้า|พูดเร็ว|พูดให้เป็นธรรมชาติ|พูดไทย|พูดอังกฤษ|ตอบสั้น|อธิบายละเอียด|อ่านให้ฟัง/iu.test(text)
    && !/stop (?:this|the) (?:task|research)|emergency/iu.test(text);
}

function isPresenceUi(text: string): boolean {
  return /go ambient|ambient mode|return to jarvis|open control center|close control center|show (?:the )?research|show system details|hide that|เข้า ambient|กลับหน้า jarvis|เปิด control center|ปิด control center|เปิด research ให้ดู|ซ่อนอันนี้/iu.test(text)
    && !/source|แหล่งข้อมูล/iu.test(text);
}

function isVisualInspect(text: string): boolean {
  return /^(zoom in|zoom out|show me the core|focus on that source|expand that|close that panel)$/iu.test(text);
}

function isCancelTask(text: string): boolean {
  return /^(stop|cancel that|stop this task|don't do that|never mind|abort the research|cancel the upload|หยุด|ยกเลิก|ไม่ต้องทำแล้ว|หยุดงานนี้|ยกเลิก research)$/iu.test(text)
    && !/emergency/iu.test(text);
}

function isTaskStatus(text: string): boolean {
  return /how far are you|what step are you on|what's left|why are you waiting|what failed|show me what you're doing|ถึงไหนแล้ว|ตอนนี้อยู่ขั้นไหน|เหลืออะไร|รออะไรอยู่|อะไรพัง|กำลังทำอะไร/iu.test(text);
}

function isReminder(text: string): boolean {
  return /\bremind|reminder|เตือน/iu.test(text);
}

function isSelfGap(text: string): boolean {
  return /why can(?:'|’)?t|what do you need from me|how could you make that possible|ทำไม.*ไม่ได้|ต้องการอะไรจากผม|มีวิธีทำให้มันทำได้ไหม/iu.test(text);
}

function isSelfKnowledge(text: string): boolean {
  return /what can you do|what are you capable of|what can'?t you do|what needs setup|can you control my computer|can you access my cctv|ทำอะไรได้บ้าง|ตอนนี้มีความสามารถอะไร|อะไรที่ยังทำไม่ได้|อะไรที่ต้องตั้งค่า|เข้าถึง cctv/iu.test(text);
}

function isSystemStatus(text: string): boolean {
  return /check (?:the )?system|how is the pc|show system (?:status|details)|what's using the gpu|how much ram|check cpu|is ollama running|is jarvis healthy|เช็กระบบ|คอมตอนนี้เป็นยังไง|gpu ใช้อยู่|แรมใช้|ollama ทำงาน|jarvis ปกติ/iu.test(text);
}

function isConversationStatus(text: string): boolean {
  return /how are you|what's going on|what's happening|what is happening|what are you doing|what are you working on|anything important|do i need to know|ตอนนี้ทำอะไรอยู่|มีอะไรสำคัญไหม|ตอนนี้เป็นยังไงบ้าง/iu.test(text);
}

function isResearchFollowup(text: string): boolean {
  return /show me the sources|open the official source|which sources disagree|why do you trust|summarize what you found|give me the short version|explain the conflict|read the conclusion|keep researching|ขอดูแหล่งข้อมูล|เปิด source official|source ไหนขัดแย้ง|สรุปสั้น|เล่าให้ฟัง|ค้นต่อ/iu.test(text);
}

function isWorkspace(text: string): boolean {
  return /open the jarvis project|search the project|find where this is implemented|run the tests|check typescript|build the project|explain this error|find the bug|fix this bug|เปิดโปรเจกต์|หา capabilityhost|รัน test|เช็ก typescript|build ให้|หา bug|แก้ bug/iu.test(text);
}

function isResearch(text: string): boolean {
  return /\bresearch\b|find the latest|look into|check whether|find reliable|compare these|find official|หาข้อมูล|รีเสิร์ช|ค้นลึก|เช็กว่าข้อมูลนี้จริง|หาหลักฐาน|เทียบสอง|หา source official/iu.test(text);
}

function wantsOpen(text: string): boolean {
  return /open|launch|start|เปิด|เข้า/iu.test(text);
}

function wantsPlace(text: string): boolean {
  return /move|put|bring .+ back|ย้าย|เอา .+ ไปจอ|เอาหน้าต่างนี้กลับ/iu.test(text);
}

function wantsFocus(text: string): boolean {
  return /bring .+ to the front|focus|maximize|minimize/iu.test(text);
}

function extractResearchQuery(text: string): string {
  return text
    .replace(/jarvis|please|research|find|look into|look up|check whether|can you|หาข้อมูล|รีเสิร์ช|ค้นลึก|ให้หน่อย|หน่อย|ครับ/giu, ' ')
    .replace(/\b(this|that|it|อันนี้|เรื่องนี้)\b/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractAfter(text: string): string {
  return text.replace(/jarvis|please|ช่วย|ให้หน่อย/giu, ' ').replace(/\s+/g, ' ').trim();
}

function firstCueIndex(haystack: string, cues: string[]): number {
  let best = -1;
  for (const cue of cues) {
    const index = haystack.indexOf(cue);
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

function sameResource(left: VoiceResource, right: VoiceResource): boolean {
  return left.label === right.label
    || (Boolean(left.applicationId) && left.applicationId === right.applicationId)
    || (Boolean(left.url) && left.url === right.url);
}

export function isWakeUtterance(text: string): boolean {
  return classifyVoiceFamily(text).family === 'WAKE';
}

import type { ActionabilityClass } from './types';

const TALK_ABOUT = /คืออะไร|ใช้ทำอะไร|ทำไม|อธิบาย|what is|what's|why (?:can'?t|cannot|doesn'?t)|explain/iu;
const EXEC_REQUEST = /รัน|execute|\brun\b|launch|start\s+(?:powershell|cmd|pwsh)|เปิด\s*(?:powershell|cmd|pwsh|cmd\.exe)/iu;
const ALWAYS_FORBIDDEN = /ignore permissions|ignore owner policy|bypass (the )?policy|bypass confirmation|use this confirmation token|install this program|open localhost|read .{0,40}\.env|winget|chocolatey|\bchoco\b|shutdown|reboot|ลบ.*system32|kill process|stop process|ms-settings:|restart all windows services|system service manager|add .+\s+to (the )?registry/iu;
const CURRENT_INFO = /ราคา|ข่าว|ล่าสุด|วันนี้|เท่าไร|เท่าไหร่|current|latest|price|news|find out|look into|look up|search the web|หาอะไร|ช่วยหา|ลองดู|เช็ค|เช็ก|ค้น|ดูข่าว|หาไฟล์|ดูไฟล์|เอกสาร|อยู่ตรงไหน|อยู่ไฟล์ไหน|สรุปเอกสาร|ดู code|ดูโค้ด/iu;
const ACTION_CUES = /เปิด|เข้า|ปิด|เริ่ม|รีสตาร์ต|รีสตาร์ท|เตือน|จัดการ|แก้|ช่วยดู|ช่วยเปิด|ช่วยหา|ตั้งค่า|ย้ายตัว|ย้ายไปจอ|ย้ายหน้าต่าง|launch|open|start|stop|restart|remind|check|handle|move yourself|move to (the )?(main|external|notebook|monitor)|maximize on|how many (monitors|displays)|which (monitor|display)/iu;
const GREETING = /^(สวัสดี|hello|hi|hey|yo)\b/iu;
const AMBIGUOUS_ONLY = /^(ช่วยทำหน่อย|ช่วยด้วย|ทำหน่อย|help me|can you help|เปิดอันนั้น|รีสตาร์ตมัน|หาอันนี้ให้หน่อย|จัดการให้หน่อย)$/iu;

export function isTalkingAboutTopic(text: string): boolean {
  return TALK_ABOUT.test(text);
}

export function isExecutionRequest(text: string): boolean {
  return EXEC_REQUEST.test(text);
}

export function isAlwaysForbidden(text: string): boolean {
  return ALWAYS_FORBIDDEN.test(text);
}

export function classifyActionability(text: string): ActionabilityClass {
  const raw = text.trim();
  if (!raw) return 'CONVERSATION';
  if (isAlwaysForbidden(raw)) return 'FORBIDDEN';
  if (isTalkingAboutTopic(raw) && !shouldTreatAsForbiddenRequest(raw)) return 'CONVERSATION';
  if (shouldTreatAsForbiddenRequest(raw)) return 'FORBIDDEN';
  if (AMBIGUOUS_ONLY.test(raw) || isVagueHelp(raw)) return 'AMBIGUOUS';
  if (GREETING.test(raw) && raw.length < 24) return 'CONVERSATION';
  if (isExplainRequest(raw) && !CURRENT_INFO.test(raw)) return 'CONVERSATION';
  if (CURRENT_INFO.test(raw)) return 'INFORMATION';
  if (ACTION_CUES.test(raw)) return 'ACTIONABLE';
  return 'CONVERSATION';
}

export function shouldTreatAsForbiddenRequest(text: string): boolean {
  if (isAlwaysForbidden(text)) return true;
  if (isTalkingAboutTopic(text)) return false;
  return isExecutionRequest(text) && /powershell|pwsh|cmd\.exe|command\.com|system32/iu.test(text);
}

function isVagueHelp(text: string): boolean {
  return /^(ช่วยทำ|ช่วยด้วย|ทำหน่อย|help(?: me)?)\b/iu.test(text.trim())
    && !/chrome|notepad|asr|spotify|youtube|rtx|nvidia|เตือน|ข่าว/iu.test(text);
}

function isExplainRequest(text: string): boolean {
  return /อธิบาย|explain|คืออะไร|what is|what's/iu.test(text);
}

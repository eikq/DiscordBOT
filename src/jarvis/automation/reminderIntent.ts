import type { ActionIntent } from '../capabilities/actions/actionIntent';
import {
  REMINDERS_CANCEL,
  REMINDERS_CREATE,
  REMINDERS_LIST,
  REMINDERS_PAUSE,
  REMINDERS_RESCHEDULE,
  REMINDERS_RESUME,
} from './constants';
import { extractReminderTitle } from './parseSchedule';

export function inferReminderIntent(text: string): ActionIntent {
  const raw = text.trim();
  if (!raw) return { kind: 'none' };

  if (isSqlCreationMethod(raw)) {
    return {
      kind: 'blocked',
      reasonCode: 'UNSUPPORTED_SQL',
      userMessage: 'Reminders cannot be created with SQL.',
    };
  }
  if (isSkillHiddenSchedule(raw)) {
    return {
      kind: 'blocked',
      reasonCode: 'UNSUPPORTED_SKILL_SCHEDULE',
      userMessage: 'Skills cannot create hidden schedules.',
    };
  }
  if (isUnsafeBulkCancel(raw)) {
    return {
      kind: 'blocked',
      reasonCode: 'BLOCKED_BULK_CANCEL',
      userMessage: 'I will not cancel a vague group of reminders.',
    };
  }
  if (isScheduledCapabilityAction(raw)) {
    return {
      kind: 'blocked',
      reasonCode: 'SCHEDULED_ACTION_UNSUPPORTED',
      userMessage: 'I can remind you, but I cannot schedule an action or program to run.',
    };
  }

  if (isListCue(raw)) {
    return { kind: 'action', consumed: true, calls: [{ id: REMINDERS_LIST, input: {} }] };
  }
  if (isCancelCue(raw)) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{ id: REMINDERS_CANCEL, input: { query: extractReminderTitle(raw) } }],
    };
  }
  if (isPauseCue(raw)) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{ id: REMINDERS_PAUSE, input: { query: extractReminderTitle(raw) } }],
    };
  }
  if (isResumeCue(raw)) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{ id: REMINDERS_RESUME, input: { query: extractReminderTitle(raw) } }],
    };
  }
  if (isRescheduleCue(raw)) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{ id: REMINDERS_RESCHEDULE, input: { query: extractTargetHint(raw), whenText: raw } }],
    };
  }
  if (hasRemindVerb(raw)) {
    return {
      kind: 'action',
      consumed: true,
      calls: [{
        id: REMINDERS_CREATE,
        input: {
          whenText: raw,
          title: extractReminderTitle(raw) || 'Reminder',
          message: extractReminderTitle(raw) || 'Reminder',
        },
      }],
    };
  }
  return { kind: 'none' };
}

function hasRemindVerb(text: string): boolean {
  const lowered = text.toLocaleLowerCase();
  return lowered.includes('เตือน')
    || /\bremind(?:er)?\b/iu.test(text)
    || /set a reminder/iu.test(text);
}

function isListCue(text: string): boolean {
  return /มี reminder|list reminders?|reminders\?|มีเตือนอะไร|เตือนอะไรบ้าง|มีอะไรต้องเตือน|ต้องเตือนบ้าง|มีอะไรเตือน/iu.test(text);
}

function isCreateScheduleCue(text: string): boolean {
  return /อีก\s*(?:ครึ่ง|\d+|หนึ่ง|สอง|สาม|สี่|ห้า)|in\s+(?:half|\d+)|ทุกวัน|พรุ่งนี้|วันนี้|every day|tomorrow|tonight/iu.test(text);
}

function isCancelCue(text: string): boolean {
  const explicitCancel = /ยกเลิกอัน|ยกเลิก reminder|cancel (?:the )?reminder|cancel the/iu.test(text);
  if (isCreateScheduleCue(text) && hasRemindVerb(text) && !explicitCancel) {
    return false;
  }
  return (/ยกเลิก|cancel reminder|cancel the/iu.test(text)
    && (hasRemindVerb(text) || /reminder|อันที่เตือน|เรื่อง/iu.test(text)));
}

function isPauseCue(text: string): boolean {
  return (/พัก|pause/iu.test(text) && (hasRemindVerb(text) || /reminder/iu.test(text)));
}

function isResumeCue(text: string): boolean {
  return (/resume|ทำงานต่อ|เปิดใช้/iu.test(text) && (hasRemindVerb(text) || /reminder/iu.test(text)));
}

function isRescheduleCue(text: string): boolean {
  return /เลื่อน|postpone|reschedule|snooze/iu.test(text) && (hasRemindVerb(text) || /อันนั้น|reminder/iu.test(text));
}

function extractTargetHint(text: string): string {
  const title = extractReminderTitle(text);
  if (title && title !== 'Reminder') return title;
  return /อันนั้น/u.test(text) ? '' : title;
}

function isSqlCreationMethod(text: string): boolean {
  return /ด้วย\s*sql|via sql|using sql|execute sql|insert into|drop table|update reminders/iu.test(text);
}

function isSkillHiddenSchedule(text: string): boolean {
  return /ใช้ skill|use (?:the )?skill|skill.*cron|cron ให้ลบ|hidden schedule/iu.test(text);
}

function isUnsafeBulkCancel(text: string): boolean {
  return /ยกเลิก reminder ทั้งหมด|cancel all reminders|ทั้งหมดที่คิดว่า|ไม่สำคัญ/iu.test(text);
}

function isScheduledCapabilityAction(text: string): boolean {
  if (/ให้\s*jarvis\s*ทำ|ตอน.*ดัง.*เปิด|when (?:the )?reminder (?:fires|sounds).*open|open chrome automatically/iu.test(text)) {
    return true;
  }
  if (hasRemindVerb(text)) return false;
  const timeCue = /อีก\s*\d+|ทุกวัน|พรุ่งนี้|วันนี้|in\s+\d+|every day|every monday|tomorrow|tonight|at \d|โมง|ทุ่ม|นาที|ชั่วโมง/iu.test(text);
  const executeCue = /รัน|execute|powershell|cmd\.exe|\.exe|เปิด\s+(chrome|cmd)|run\s+|สร้าง\s*cron/iu.test(text);
  return timeCue && executeCue;
}

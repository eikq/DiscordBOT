export const POLICY_OUTCOMES = [
  'EXECUTE',
  'ASK_PERMISSION',
  'NEED_INPUT',
  'NEED_CAPABILITY',
  'REFUSE',
] as const;

export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export type PermissionFirstDecision = {
  outcome: PolicyOutcome;
  userMessage: string;
  reasonCode: string;
};

const FALSE_REFUSAL_CUES = /create (?:project )?files|write code|run (?:the |unit )?tests?|รัน\s*(?:unit\s*)?tests?|start (?:a )?dev server|research documentation|documentation|build a website|สร้างไฟล์|เขียนโค้ด|รันเทสต์|สตาร์ท dev|ค้นเอกสาร|หาข้อมูล/iu;

export function permissionFirstFromCapability(input: {
  capabilityId?: string;
  status?: string;
  reasonCode?: string;
  userMessage?: string;
  confirmationRequired?: boolean;
  missingInput?: boolean;
  unavailable?: boolean;
  ownerDenied?: boolean;
  unsafeUnscoped?: boolean;
  hardSafety?: boolean;
}): PermissionFirstDecision {
  if (input.ownerDenied) {
    return { outcome: 'REFUSE', reasonCode: 'OWNER_DENIED', userMessage: input.userMessage || 'You denied that action, so I stopped.' };
  }
  if (input.hardSafety) {
    return { outcome: 'REFUSE', reasonCode: input.reasonCode || 'HARD_SAFETY', userMessage: input.userMessage || 'That stays outside Jarvis authority.' };
  }
  if (input.unsafeUnscoped) {
    return { outcome: 'REFUSE', reasonCode: 'UNSCOPED', userMessage: input.userMessage || 'I cannot run that without a bounded target.' };
  }
  if (input.confirmationRequired) {
    return {
      outcome: 'ASK_PERMISSION',
      reasonCode: input.reasonCode || 'ASK_PERMISSION',
      userMessage: input.userMessage || 'ทำได้ครับ แต่ต้องขอสิทธิ์ในขอบเขตงานนี้ก่อน',
    };
  }
  if (input.missingInput) {
    return {
      outcome: 'NEED_INPUT',
      reasonCode: input.reasonCode || 'NEED_INPUT',
      userMessage: input.userMessage || 'ทำได้ครับ แต่ขอรายละเอียดที่จำเป็นอีกนิด',
    };
  }
  if (input.unavailable) {
    return {
      outcome: 'NEED_CAPABILITY',
      reasonCode: input.reasonCode || 'NEED_CAPABILITY',
      userMessage: input.userMessage || 'ตอนนี้ผมยังไม่มี capability นั้นโดยตรง แต่ผมหาเส้นทางที่ปลอดภัยกว่านี้ให้ได้',
    };
  }
  if (input.status === 'ok' || input.status === 'completed') {
    return {
      outcome: 'EXECUTE',
      reasonCode: input.reasonCode || 'EXECUTE',
      userMessage: input.userMessage || '',
    };
  }
  return {
    outcome: 'NEED_CAPABILITY',
    reasonCode: input.reasonCode || 'NEED_CAPABILITY',
    userMessage: input.userMessage || 'ผมหาเส้นทางที่ปลอดภัยกว่าการปฏิเสธให้ก่อน',
  };
}

export function shouldAvoidGenericRefusal(text: string): boolean {
  return FALSE_REFUSAL_CUES.test(text);
}

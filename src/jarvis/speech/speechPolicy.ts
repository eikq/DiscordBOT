/**
 * Deterministic speech policy. Same situation → same speak/skip decision.
 * Owner preferences change density, never security or capability authority.
 */

export const SPEECH_CLASSES = [
  'greeting',
  'acknowledgement',
  'action_complete',
  'permission',
  'warning',
  'error',
  'reminder',
  'emergency',
  'blocked',
  'research_progress',
  'status_update',
  'telemetry',
  'task_complete',
  'clarification',
  'conversation',
] as const;

export type SpeechClass = (typeof SPEECH_CLASSES)[number];

export const SPEECH_MODES = [
  'normal',
  'important_only',
  'updates',
  'quiet_research',
  'final_only',
] as const;

export type SpeechMode = (typeof SPEECH_MODES)[number];

export type SpeechDecision = 'ALWAYS_SPEAK' | 'OPTIONAL_SPEAK' | 'SILENT_BY_DEFAULT';

export type SpeechPolicyInput = {
  speechClass: SpeechClass;
  mode?: SpeechMode;
  speakRequested?: boolean;
  muted?: boolean;
  duplicateOfLast?: boolean;
};

export type SpeechPolicyResult = {
  speak: boolean;
  decision: SpeechDecision;
  reasonCode: string;
};

const ALWAYS: ReadonlySet<SpeechClass> = new Set([
  'greeting',
  'acknowledgement',
  'action_complete',
  'permission',
  'warning',
  'error',
  'reminder',
  'emergency',
  'blocked',
  'clarification',
  'task_complete',
]);

const OPTIONAL: ReadonlySet<SpeechClass> = new Set([
  'research_progress',
  'status_update',
  'conversation',
]);

export function speechDecisionFor(speechClass: SpeechClass): SpeechDecision {
  if (ALWAYS.has(speechClass)) return 'ALWAYS_SPEAK';
  if (OPTIONAL.has(speechClass)) return 'OPTIONAL_SPEAK';
  return 'SILENT_BY_DEFAULT';
}

export function decideSpeech(input: SpeechPolicyInput): SpeechPolicyResult {
  if (input.muted) {
    return { speak: false, decision: speechDecisionFor(input.speechClass), reasonCode: 'SPEECH_MUTED' };
  }
  if (input.duplicateOfLast) {
    return { speak: false, decision: speechDecisionFor(input.speechClass), reasonCode: 'DUPLICATE_SUPPRESSED' };
  }
  const decision = speechDecisionFor(input.speechClass);
  const mode = input.mode ?? 'normal';

  if (decision === 'SILENT_BY_DEFAULT') {
    return { speak: false, decision, reasonCode: 'SILENT_TELEMETRY' };
  }
  if (decision === 'ALWAYS_SPEAK') {
    if (mode === 'quiet_research' && input.speechClass === 'research_progress') {
      return { speak: false, decision: 'OPTIONAL_SPEAK', reasonCode: 'QUIET_RESEARCH' };
    }
    return { speak: true, decision, reasonCode: 'ALWAYS_SPEAK' };
  }

  if (mode === 'important_only' || mode === 'final_only') {
    return { speak: false, decision, reasonCode: 'OPTIONAL_SUPPRESSED_BY_MODE' };
  }
  if (mode === 'quiet_research' && input.speechClass === 'research_progress') {
    return { speak: false, decision, reasonCode: 'QUIET_RESEARCH' };
  }
  if (mode === 'updates' || input.speakRequested) {
    return { speak: true, decision, reasonCode: 'OPTIONAL_REQUESTED' };
  }
  return { speak: Boolean(input.speakRequested), decision, reasonCode: input.speakRequested ? 'OPTIONAL_REQUESTED' : 'OPTIONAL_DEFAULT_OFF' };
}

export function classifySpeechEvent(input: {
  kind?: string;
  reasonCode?: string;
  pendingPermission?: boolean;
  emergency?: boolean;
  error?: boolean;
  reminder?: boolean;
  researchProgress?: boolean;
  actionCompleted?: boolean;
  greeting?: boolean;
  blocked?: boolean;
  clarification?: boolean;
  conversation?: boolean;
}): SpeechClass {
  if (input.emergency) return 'emergency';
  if (input.error) return 'error';
  if (input.blocked || input.reasonCode?.startsWith('BLOCKED') || input.kind === 'FORBIDDEN') return 'blocked';
  if (input.pendingPermission || input.kind === 'PERMISSION') return 'permission';
  if (input.clarification || input.kind === 'CLARIFICATION') return 'clarification';
  if (input.reminder) return 'reminder';
  if (input.greeting) return 'greeting';
  if (input.actionCompleted) return 'action_complete';
  if (input.researchProgress) return 'research_progress';
  if (input.reasonCode === 'WAKE' || input.reasonCode === 'ACKNOWLEDGEMENT') return 'acknowledgement';
  if (input.conversation || input.kind === 'CONVERSATION') return 'conversation';
  return 'status_update';
}

export function parseSpeechModeCommand(text: string): SpeechMode | null {
  const raw = text.trim();
  if (/only speak when you need me|important updates only|บอกเฉพาะเรื่องสำคัญ|พูดเฉพาะตอนต้องการ/iu.test(raw)) return 'important_only';
  if (/stay quiet while researching|ตอน research ไม่ต้องพูด|don't narrate|ไม่ต้องพูดทุกขั้น/iu.test(raw)) return 'quiet_research';
  if (/keep me updated|คอยอัปเดต/iu.test(raw)) return 'updates';
  if (/tell me when (?:the )?task is finished|read the final result|เสร็จแล้วบอก|เสร็จแล้วอ่าน/iu.test(raw)) return 'final_only';
  if (/speak normally|พูดแบบปกติ/iu.test(raw)) return 'normal';
  return null;
}

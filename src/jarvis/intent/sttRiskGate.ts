import { classifyVoiceFamily } from './voiceFamilies';

export type SttRiskDecision =
  | { execute: true; reasonCode: 'STT_OK' | 'STT_LOW_CONVERSATION' }
  | { execute: false; reasonCode: 'STT_LOW_CONFIDENCE_RISKY'; message: string };

export function sttMayExecute(input: {
  text: string;
  confidence?: number | null;
  threshold?: number;
}): SttRiskDecision {
  const confidence = input.confidence;
  const threshold = input.threshold ?? 0.8;
  if (confidence === undefined || confidence === null || confidence >= threshold) {
    return { execute: true, reasonCode: 'STT_OK' };
  }
  if (/delete|remove|uninstall|format|wipe|ลบโปรเจกต์|ลบทั้งหมด/iu.test(input.text)) {
    return {
      execute: false,
      reasonCode: 'STT_LOW_CONFIDENCE_RISKY',
      message: `I heard “${input.text}”, but confidence is low. Please repeat that.`,
    };
  }
  const slots = classifyVoiceFamily(input.text);
  if (!slots.mutating && (slots.family === 'WAKE' || slots.family === 'CONVERSATION_STATUS' || slots.family === 'SPEECH_CONTROL' || slots.family === 'UNKNOWN')) {
    return { execute: true, reasonCode: 'STT_LOW_CONVERSATION' };
  }
  return {
    execute: false,
    reasonCode: 'STT_LOW_CONFIDENCE_RISKY',
    message: `I heard “${input.text}”, but confidence is low. Please repeat that.`,
  };
}

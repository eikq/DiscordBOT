import type { SpeechMode } from './speechPolicy';

export type SpeechControl =
  | { kind: 'stop' }
  | { kind: 'pause' }
  | { kind: 'continue' }
  | { kind: 'repeat' }
  | { kind: 'rate'; rate: 'slower' | 'faster' | 'natural' }
  | { kind: 'language'; language: 'th' | 'en' }
  | { kind: 'verbosity'; verbosity: 'short' | 'detailed' }
  | { kind: 'read-aloud' }
  | { kind: 'skip-sources' };

export type SpeechSessionState = {
  mode: SpeechMode;
  muted: boolean;
  paused: boolean;
  lastSpoken?: string;
  rate: 'normal' | 'slower' | 'faster' | 'natural';
  language?: 'th' | 'en';
  verbosity: 'normal' | 'short' | 'detailed';
};

export function defaultSpeechSession(): SpeechSessionState {
  return {
    mode: 'normal',
    muted: false,
    paused: false,
    rate: 'normal',
    verbosity: 'normal',
  };
}

export function parseSpeechControl(text: string): SpeechControl | null {
  const raw = text.trim();
  if (/^pause (?:speaking|talking)$/iu.test(raw) || /pause speaking|pause talking/iu.test(raw)) {
    return { kind: 'pause' };
  }
  if (/^(stop talking|be quiet|shut up|หยุดพูด|เงียบก่อน)$/iu.test(raw) || /stop talking|be quiet|shut up|หยุดพูด|เงียบก่อน/iu.test(raw) && !/stop (?:this|the) (?:task|research)/iu.test(raw)) {
    return { kind: 'stop' };
  }
  if (/continue speaking|พูดต่อ|resume speaking/iu.test(raw)) return { kind: 'continue' };
  if (/say that again|repeat that|พูดอีกที|พูดอีกครั้ง/iu.test(raw)) return { kind: 'repeat' };
  if (/speak slower|พูดช้า/iu.test(raw)) return { kind: 'rate', rate: 'slower' };
  if (/speak faster|พูดเร็ว/iu.test(raw)) return { kind: 'rate', rate: 'faster' };
  if (/speak more naturally|พูดให้เป็นธรรมชาติ/iu.test(raw)) return { kind: 'rate', rate: 'natural' };
  if (/speak thai|พูดไทย/iu.test(raw)) return { kind: 'language', language: 'th' };
  if (/speak english|พูดอังกฤษ/iu.test(raw)) return { kind: 'language', language: 'en' };
  if (/keep the answer short|ตอบสั้น/iu.test(raw)) return { kind: 'verbosity', verbosity: 'short' };
  if (/explain it in detail|อธิบายละเอียด/iu.test(raw)) return { kind: 'verbosity', verbosity: 'detailed' };
  if (/read (?:that|it|the conclusion) aloud|อ่านให้ฟัง/iu.test(raw)) return { kind: 'read-aloud' };
  if (/don't read the sources|ไม่ต้องอ่าน source/iu.test(raw)) return { kind: 'skip-sources' };
  return null;
}

export function applySpeechControl(state: SpeechSessionState, control: SpeechControl): SpeechSessionState {
  switch (control.kind) {
    case 'stop':
      return { ...state, muted: true, paused: false };
    case 'pause':
      return { ...state, paused: true };
    case 'continue':
      return { ...state, muted: false, paused: false };
    case 'repeat':
      return { ...state, muted: false, paused: false };
    case 'rate':
      return { ...state, rate: control.rate };
    case 'language':
      return { ...state, language: control.language };
    case 'verbosity':
      return { ...state, verbosity: control.verbosity };
    case 'read-aloud':
      return { ...state, muted: false, paused: false };
    case 'skip-sources':
      return state;
  }
}

/** Speech controls never grant, deny, or invent capability authority. */
export function speechControlChangesAuthority(): false {
  return false;
}

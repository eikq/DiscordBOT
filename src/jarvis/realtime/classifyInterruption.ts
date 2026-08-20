import { routeJarvisRequest } from '../intent/requestRouter';
import type { InterruptionKind } from './types';

const STOP = /^(stop|cancel|พอ|หยุด|เงียบ|ยกเลิก|อย่าพูด|quiet)([!. ]|$)/iu;
const CORRECTION = /(ไม่ใช่|ผิด|แก้เป็น|เปลี่ยนเป็น|\bactually\b|\bi meant\b|\bcorrection\b)/iu;
const QUESTION = /(\?|ไหม|มั้ย|หรือเปล่า|อะไร|ทำไม|why\b|what\b|how\b|which\b)/iu;

/**
 * Classify an owner utterance that arrived while Jarvis was speaking.
 * Deterministic. Does not execute work.
 */
export function classifyInterruption(text: string): InterruptionKind {
  const trimmed = text.trim();
  if (!trimmed) return 'unknown';
  if (STOP.test(trimmed) && trimmed.length < 24) return 'stop';
  if (CORRECTION.test(trimmed)) return 'correction';
  const routed = routeJarvisRequest({ text: trimmed });
  if (routed.agentic || routed.route === 'WORK' || routed.route === 'CAPABILITY' || routed.route === 'RESEARCH') {
    return 'new_command';
  }
  if (QUESTION.test(trimmed) || routed.reason === 'information_question') return 'question';
  if (routed.route === 'INFORMATION') return 'question';
  if (routed.route === 'CONVERSATION') return trimmed.length > 48 ? 'new_command' : 'question';
  return 'unknown';
}

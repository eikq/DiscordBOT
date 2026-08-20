import type { MemoryClass } from '../../bot/memory/jarvis/types';

export const MEMORY_REQUEST_CLASSES = ['conversation', 'technical', 'device', 'general'] as const;
export type MemoryRequestClass = (typeof MEMORY_REQUEST_CLASSES)[number];

const DEVICE = /\b(camera|display|monitor|device|cctv|sensor|microphone|จอ|กล้อง|เครื่อง)\b/iu;
const TECHNICAL = /\b(how do i|how to|restart|procedure|playbook|night agent|code|build|schema|sqlite|qdrant|project|compile|ขั้นตอน|โปรเจกต์)\b/iu;
const CONVERSATION = /\b(hello|hi|hey|how are|feeling|friend|spin|สปิน|คุย|ชอบ|สวัสดี|เป็นไง)\b/iu;

export function memoryRequestClass(text: string): MemoryRequestClass {
  const value = String(text || '');
  if (DEVICE.test(value)) return 'device';
  if (TECHNICAL.test(value)) return 'technical';
  if (CONVERSATION.test(value)) return 'conversation';
  return 'general';
}

export function classesForRequest(kind: MemoryRequestClass): MemoryClass[] {
  switch (kind) {
    case 'conversation':
      return ['identity', 'social', 'episodic'];
    case 'technical':
      return ['procedural', 'semantic'];
    case 'device':
      return ['perceptual', 'procedural'];
    default:
      return ['identity', 'social', 'semantic', 'episodic'];
  }
}

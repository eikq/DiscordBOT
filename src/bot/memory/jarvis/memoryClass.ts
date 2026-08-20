import { MEMORY_CLASSES, type MemoryClass } from './types';

const CLASS_SET = new Set<string>(MEMORY_CLASSES);

export function isMemoryClass(value: string): value is MemoryClass {
  return CLASS_SET.has(value);
}

export function inferMemoryClass(input: {
  kind?: string;
  factKey?: string;
  memoryClass?: string;
  memoryType?: string;
  eventType?: string;
  retentionClass?: string;
}): MemoryClass {
  if (input.memoryClass && isMemoryClass(input.memoryClass)) return input.memoryClass;
  if (input.kind === 'episode') return 'episodic';
  if (input.kind === 'observation') return 'perceptual';
  if (input.kind === 'identity') return 'identity';
  if (input.retentionClass === 'ephemeral' || input.retentionClass === 'session') return 'working';
  const haystack = `${input.factKey || ''} ${input.memoryType || ''} ${input.eventType || ''}`.toLowerCase();
  if (haystack.startsWith('identity') || /\b(identity|preferred|favorite|owner\.|ชื่อ)\b/u.test(haystack)) {
    return 'identity';
  }
  if (haystack.startsWith('social') || /\b(social|relationship|friend|คน)\b/u.test(haystack)) {
    return 'social';
  }
  if (
    haystack.startsWith('procedure')
    || haystack.startsWith('project')
    || /\b(procedur|how_to|howto|playbook|night.?agent|restart)\b/u.test(haystack)
  ) {
    return 'procedural';
  }
  if (
    haystack.startsWith('device')
    || /\b(device|camera|sensor|percept|display|monitor|cctv|กล้อง)\b/u.test(haystack)
  ) {
    return 'perceptual';
  }
  if (/\b(working|scratch|tmp)\b/u.test(haystack)) return 'working';
  if (input.memoryType === 'social') return 'social';
  if (input.memoryType === 'identity') return 'identity';
  return 'semantic';
}

export function storageFactMemoryType(
  memoryClass: MemoryClass,
): 'semantic' | 'social' | 'identity' {
  if (memoryClass === 'social') return 'social';
  if (memoryClass === 'identity') return 'identity';
  return 'semantic';
}

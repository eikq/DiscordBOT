import { MEMORY_KINDS, MemoryKind } from './types';

const KIND_SET = new Set<string>(MEMORY_KINDS);

export function canonicalMemoryId(kind: MemoryKind, localId: string): string {
  const clean = String(localId || '')
    .trim()
    .replace(/[^a-zA-Z0-9._:-]/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_|_$/gu, '')
    .slice(0, 180);
  if (!clean) throw new Error('A canonical memory id requires a non-empty local id.');
  return `${kind}:${clean}`;
}

export function parseCanonicalMemoryId(id: string): { kind: MemoryKind; localId: string } {
  const match = String(id || '').match(/^([a-z]+):(.+)$/u);
  if (!match || !KIND_SET.has(match[1])) {
    throw new Error(`Invalid canonical memory id: ${id}`);
  }
  return { kind: match[1] as MemoryKind, localId: match[2] };
}

export function isCanonicalMemoryId(id: string): boolean {
  try {
    parseCanonicalMemoryId(id);
    return true;
  } catch {
    return false;
  }
}

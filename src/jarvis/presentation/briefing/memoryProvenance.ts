import type { MemoryProvenanceItem, PresentationInput } from './types';

const PROVENANCE_HINT = /remembered this because|memory provenance|ทำไมจำ|จำได้เพราะ|why (?:did|do) you remember/iu;

export function wantsMemoryProvenanceView(text: string, explicit?: boolean): boolean {
  if (explicit) return true;
  return PROVENANCE_HINT.test(String(text || ''));
}

export function describeMemoryProvenance(item: MemoryProvenanceItem): string {
  const because = [
    item.sourceSystem ? `source ${item.sourceSystem}` : undefined,
    item.sourceRefs && item.sourceRefs.length > 0 ? `refs ${item.sourceRefs.join(', ')}` : undefined,
    item.status ? `status ${item.status}` : undefined,
    item.memoryClass ? `class ${item.memoryClass}` : undefined,
    item.ownerTrusted ? 'owner-trusted' : 'not owner-trusted',
    item.derived ? 'derived' : undefined,
  ].filter(Boolean).join('; ');
  return `Jarvis remembered this because ${because}.`;
}

export function shouldAttachMemoryProvenance(input: PresentationInput): boolean {
  return Boolean(
    input.memoryProvenance?.length
    && wantsMemoryProvenanceView(input.text, input.showMemoryProvenance),
  );
}

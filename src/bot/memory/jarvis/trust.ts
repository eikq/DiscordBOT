const UNTRUSTED_SOURCE = /^(?:research(?:\.|$)|world-intel|web(?:page)?(?:\.|$)|untrusted:|model(?:\.|$)|llm(?:\.|$)|vision(?:\.|$)|skill(?:\.|$))/iu;

export function isUntrustedMemorySource(sourceSystem: string): boolean {
  const value = String(sourceSystem || '').trim();
  if (!value) return false;
  if (UNTRUSTED_SOURCE.test(value)) return true;
  const lower = value.toLowerCase();
  return lower.includes('world-intel')
    || lower.startsWith('research')
    || lower === 'webpage'
    || lower.startsWith('webpage.');
}

export function ownerTrustedForWrite(sourceSystem: string, requested?: boolean): boolean {
  if (isUntrustedMemorySource(sourceSystem)) return false;
  if (requested === false) return false;
  if (requested === true) return true;
  return /^(?:owner|owner_correction|identity)(?:\.|$)/iu.test(sourceSystem);
}

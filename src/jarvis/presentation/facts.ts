import type { JarvisCoreResult, VerifiedFact } from '../core/types';

function factValueText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

export function immutableFacts(result: JarvisCoreResult): VerifiedFact[] {
  return result.verifiedFacts.filter(fact => fact.immutableForPresentation);
}

export function presentationContradictsFacts(text: string, result: JarvisCoreResult): string[] {
  const haystack = text.toLocaleLowerCase();
  return immutableFacts(result).flatMap(fact => {
    const value = factValueText(fact.value);
    if (!value) return [];
    if (haystack.includes(value.toLocaleLowerCase())) return [];
    return [`missing immutable fact ${fact.key}=${value}`];
  });
}

export function ensureImmutableFacts(text: string, result: JarvisCoreResult): string {
  const trimmed = text.trim();
  if (presentationContradictsFacts(trimmed, result).length === 0) return trimmed;
  const restored = immutableFacts(result)
    .map(fact => factValueText(fact.value))
    .filter((value): value is string => Boolean(value))
    .join(' ');
  return [trimmed, restored].filter(Boolean).join(' ').trim();
}

export function styleSuggestedContent(result: JarvisCoreResult, slangPrefix = ''): string {
  const prefix = slangPrefix.trim();
  const base = result.suggestedContent.trim();
  return ensureImmutableFacts([prefix, base].filter(Boolean).join(' '), result);
}

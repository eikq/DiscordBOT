import type { DisplaySelector } from '../desktop/monitorTopology';
import type { InteractionContext } from '../intent/types';

export type LastOpenedResource = NonNullable<InteractionContext['lastOpenedResource']>;

export function observedDisplaySelector(input: {
  displayId?: unknown;
  displayFingerprint?: unknown;
}): DisplaySelector | undefined {
  const displayId = typeof input.displayId === 'string' && input.displayId.trim()
    ? input.displayId.trim()
    : undefined;
  const fingerprint = typeof input.displayFingerprint === 'string' && input.displayFingerprint.trim()
    ? input.displayFingerprint.trim()
    : undefined;
  if (!displayId && !fingerprint) return undefined;
  const stable = fingerprint && (fingerprint.startsWith('display.fp:') || fingerprint.startsWith('{'))
    ? fingerprint
    : undefined;
  return {
    raw: stable || displayId || fingerprint || '',
    ...(displayId ? { name: displayId } : {}),
    ...(stable ? { fingerprint: stable } : {}),
  };
}

export const MEMORY_TURN_BUDGET = {
  activeTask: 1,
  aliases: 6,
  facts: 4,
  episodes: 2,
  maxChars: 900,
} as const;

export function applyOpenedResource(
  context: InteractionContext | null | undefined,
  resource: LastOpenedResource,
  options: { verified?: boolean } = {},
): Pick<InteractionContext, 'lastOpenedResource' | 'lastDisplay' | 'previousDisplay' | 'lastApplicationId' | 'currentDisplay' | 'currentWebsite' | 'currentApplication' | 'currentWindow'> {
  const verified = options.verified === true;
  const nextDisplay = verified ? (resource.display ?? context?.lastDisplay) : context?.lastDisplay;
  const previous = verified && resource.display && context?.lastDisplay && JSON.stringify(resource.display) !== JSON.stringify(context.lastDisplay)
    ? context.lastDisplay
    : context?.previousDisplay;
  return {
    lastOpenedResource: {
      ...resource,
      placementScope: resource.placementScope || (resource.windowHandle ? 'managed-window' : resource.url ? 'process-window' : 'unknown'),
      previousDisplayId: verified
        ? context?.lastOpenedResource?.currentDisplayId
        : context?.lastOpenedResource?.previousDisplayId,
      currentDisplayId: verified
        ? resource.currentDisplayId ?? context?.lastOpenedResource?.currentDisplayId
        : context?.lastOpenedResource?.currentDisplayId,
    },
    previousDisplay: previous,
    lastDisplay: nextDisplay,
    currentDisplay: verified ? (resource.display ?? context?.currentDisplay) : context?.currentDisplay,
    lastApplicationId: resource.applicationId ?? context?.lastApplicationId,
    currentWebsite: resource.url ?? context?.currentWebsite,
    currentApplication: resource.applicationId ?? context?.currentApplication,
    currentWindow: resource.windowHandle || resource.managedWindowId || resource.label,
  };
}

export function referentIsAmbiguous(context: InteractionContext | null | undefined, candidates: string[]): boolean {
  return candidates.length > 1 || (!context?.lastOpenedResource && candidates.length === 0);
}

export function boundMemoryBlock(parts: string[]): string {
  const joined = parts.filter(Boolean).join('\n');
  return joined.slice(0, MEMORY_TURN_BUDGET.maxChars);
}

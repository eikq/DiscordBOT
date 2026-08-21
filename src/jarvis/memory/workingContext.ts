import type { InteractionContext } from '../intent/types';

export type LastOpenedResource = NonNullable<InteractionContext['lastOpenedResource']>;

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
): Pick<InteractionContext, 'lastOpenedResource' | 'lastDisplay' | 'previousDisplay' | 'lastApplicationId' | 'currentDisplay' | 'currentWebsite' | 'currentApplication' | 'currentWindow'> {
  return {
    lastOpenedResource: {
      ...resource,
      placementScope: resource.placementScope || (resource.url ? 'process-window' : 'unknown'),
      previousDisplayId: context?.lastOpenedResource?.currentDisplayId,
    },
    previousDisplay: context?.lastDisplay,
    lastDisplay: resource.display ?? context?.lastDisplay,
    currentDisplay: resource.display ?? context?.currentDisplay,
    lastApplicationId: resource.applicationId ?? context?.lastApplicationId,
    currentWebsite: resource.url ?? context?.currentWebsite,
    currentApplication: resource.applicationId ?? context?.currentApplication,
    currentWindow: resource.windowHandle || resource.label,
  };
}

export function referentIsAmbiguous(context: InteractionContext | null | undefined, candidates: string[]): boolean {
  return candidates.length > 1 || (!context?.lastOpenedResource && candidates.length === 0);
}

export function boundMemoryBlock(parts: string[]): string {
  const joined = parts.filter(Boolean).join('\n');
  return joined.slice(0, MEMORY_TURN_BUDGET.maxChars);
}

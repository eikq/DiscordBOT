import { defaultJarvisPresentation } from '../presentation/compatibility';
import type { PresentationProfile } from '../presentation/types';
import type { JarvisClientSource, JarvisRequest } from './types';

export type CreateJarvisRequestInput = {
  text: string;
  requestId?: string;
  source?: JarvisClientSource;
  sessionId?: string;
  language?: string;
  presentation?: PresentationProfile;
  capabilities?: string[];
  capabilityCalls?: JarvisRequest['capabilityCalls'];
  actionOnly?: boolean;
  presetActionResults?: JarvisRequest['presetActionResults'];
  actionSource?: JarvisRequest['actionSource'];
  clientContext?: JarvisRequest['clientContext'];
};

/**
 * Build a transport-neutral Jarvis request. `guildId` / `channelId` on
 * clientContext are optional opaque ids, not Discord.js types.
 */
export function createJarvisRequest(input: CreateJarvisRequestInput): JarvisRequest {
  const text = input.text.trim();
  const requestId = input.requestId?.trim() || `jarvis-${Date.now()}`;
  const sessionId = input.clientContext?.sessionId || input.sessionId?.trim() || 'standalone';
  return {
    requestId,
    source: input.source ?? 'desktop',
    input: {
      text,
      language: input.language,
    },
    clientContext: {
      sessionId,
      ...input.clientContext,
    },
    presentation: input.presentation ?? defaultJarvisPresentation(),
    capabilities: input.capabilities ?? [],
    ...(input.capabilityCalls ? { capabilityCalls: input.capabilityCalls } : {}),
    ...(input.actionOnly ? { actionOnly: true } : {}),
    ...(input.presetActionResults ? { presetActionResults: input.presetActionResults } : {}),
    ...(input.actionSource ? { actionSource: input.actionSource } : {}),
  };
}

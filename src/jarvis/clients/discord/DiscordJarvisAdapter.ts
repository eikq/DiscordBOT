import { UnavailableJarvisCore } from '../../core/JarvisCore';
import type { JarvisCore, JarvisCoreResult, JarvisRequest } from '../../core/types';
import type { SocialDecision } from '../../../bot/brain/types';
import type { PresentationProfile } from '../../presentation/types';

export type DiscordJarvisTurnInput = {
  requestId: string;
  sessionId: string;
  guildId?: string;
  channelId?: string;
  speakerUserId?: string;
  participants?: string[];
  text: string;
  language?: string;
  presentation: PresentationProfile;
  capabilities?: string[];
  decision: SocialDecision;
};

export type DiscordJarvisTurnResult = {
  decision: SocialDecision;
  coreResult?: JarvisCoreResult;
  usedLegacyGenerateFallback: boolean;
};

/**
 * Discord/Digital Me adapter around Jarvis Core.
 * SocialBrain remains the turn-taking gate; Core reasons only after a speak decision.
 * Transport (Opus, Discord.js, TTS) stays outside this class and outside Core.
 */
export class DiscordJarvisAdapter {
  constructor(private readonly core: JarvisCore = new UnavailableJarvisCore()) {}

  public shouldReason(decision: SocialDecision): boolean {
    return decision.action !== 'IGNORE' && decision.action !== 'LISTEN';
  }

  public async reasonAfterSocialDecision(input: DiscordJarvisTurnInput): Promise<DiscordJarvisTurnResult> {
    if (!this.shouldReason(input.decision)) {
      return { decision: input.decision, usedLegacyGenerateFallback: false };
    }

    const request: JarvisRequest = {
      requestId: input.requestId,
      source: 'discord',
      input: { text: input.text, language: input.language },
      clientContext: {
        sessionId: input.sessionId,
        guildId: input.guildId,
        channelId: input.channelId,
        speakerUserId: input.speakerUserId,
        participants: input.participants,
      },
      presentation: input.presentation,
      capabilities: input.capabilities ?? [],
    };

    const coreResult = await this.core.handle(request);
    if (coreResult.answerIntent === 'unavailable') {
      return {
        decision: input.decision,
        usedLegacyGenerateFallback: true,
      };
    }

    return {
      decision: input.decision,
      coreResult,
      usedLegacyGenerateFallback: false,
    };
  }
}

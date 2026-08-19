import { JARVIS_VOICE_ID } from '../presentation/types';
import { EnvCloneConsent } from './consent';
import { edgeTtsAvailable, synthesizeEdgeTts } from './edgeTts';
import { cancelJaitts, probeJaitts, synthesizeJaitts } from './jaittsClient';
import { StandaloneVoiceResourcePolicy } from './resourcePolicy';
import { resolveVoiceRoute } from './routes';
import { cancelRvc, convertWithRvc, probeRvc } from './rvcConvert';
import { TurnGate } from './TurnGate';
import type {
  CloneConsentGate,
  RvcConverter,
  SourceTtsEngine,
  SourceTtsSynthesizer,
  VoiceOutputResult,
  VoiceOutputRouter,
  VoiceProfile,
  VoiceTurnContext,
} from './types';

export type StandaloneVoiceRouterOptions = {
  synthesizer?: SourceTtsSynthesizer;
  rvc?: RvcConverter;
  consent?: CloneConsentGate;
  policy?: StandaloneVoiceResourcePolicy;
  probeServices?: () => Promise<{ qwenLoaded: boolean; asrReachable: boolean; jaittsReady: boolean; rvcReady: boolean }>;
  enabled?: boolean;
};

export class StandaloneVoiceRouter implements VoiceOutputRouter {
  private readonly synthesizer?: SourceTtsSynthesizer;
  private readonly rvc?: RvcConverter;
  private readonly consent: CloneConsentGate;
  private readonly policy: StandaloneVoiceResourcePolicy;
  private readonly probeServices: StandaloneVoiceRouterOptions['probeServices'];
  private readonly enabled: boolean;
  private readonly gate = new TurnGate();
  private speaking = false;

  constructor(options: StandaloneVoiceRouterOptions = {}) {
    this.synthesizer = options.synthesizer;
    this.rvc = options.rvc;
    this.consent = options.consent ?? new EnvCloneConsent();
    this.policy = options.policy ?? new StandaloneVoiceResourcePolicy();
    this.probeServices = options.probeServices;
    this.enabled = options.enabled !== false;
  }

  public resolveProfile(profileId: string): VoiceProfile {
    return resolveVoiceRoute(profileId);
  }

  public async probeProfile(profileId: string) {
    const profile = this.resolveProfile(profileId);
    const services = await this.services();
    if (profile.kind === 'native') {
      const ready = this.enabled && (Boolean(this.synthesizer) || edgeTtsAvailable());
      return {
        profileId: profile.profileId,
        available: ready,
        speechActive: ready,
        runtimeState: (this.speaking ? 'speaking' : ready ? 'ready' : 'unavailable') as 'speaking' | 'ready' | 'unavailable',
        reason: ready
          ? 'Jarvis native voice uses Edge-TTS. Speech is ready.'
          : 'Jarvis native voice is selected but Edge-TTS is unavailable.',
      };
    }
    const consented = this.consent.isCloneConsented(profile.profileId);
    if (!consented) {
      return {
        profileId: profile.profileId,
        available: false,
        speechActive: false,
        consented: false,
        runtimeState: 'unavailable' as const,
        reason: `${profile.profileId} selected. ${profile.profileId} speech unavailable (clone consent not granted for standalone).`,
      };
    }
    if (!profile.speakerId) {
      return {
        profileId: profile.profileId,
        available: false,
        speechActive: false,
        consented: true,
        runtimeState: 'unavailable' as const,
        reason: `${profile.profileId} selected. ${profile.profileId} speech unavailable (no standalone speaker mapping).`,
      };
    }
    const rvc = this.policy.canUseRvc(profile, services);
    if (!rvc.ok) {
      return {
        profileId: profile.profileId,
        available: false,
        speechActive: false,
        consented: true,
        runtimeState: 'unavailable' as const,
        reason: `${profile.profileId} selected. ${profile.profileId} speech unavailable (${rvc.reason}).`,
      };
    }
    return {
      profileId: profile.profileId,
      available: true,
      speechActive: true,
      consented: true,
      runtimeState: (this.speaking ? 'speaking' : 'ready') as 'speaking' | 'ready',
      reason: `${profile.profileId} clone route is ready (source TTS + RVC).`,
    };
  }

  public async speak(text: string, profile: VoiceProfile, turn: VoiceTurnContext): Promise<VoiceOutputResult> {
    const started = Date.now();
    const spoken = text.trim();
    if (!this.enabled) {
      return this.finish(turn.turnId, profile, 'skipped', started, { reason: 'Speech is off.' });
    }
    if (!spoken) {
      return this.finish(turn.turnId, profile, 'skipped', started, { reason: 'No text to speak.' });
    }
    this.gate.take(turn.turnId);
    this.policy.enter('speaking');
    this.speaking = true;
    const blocked = await this.blockReason(profile);
    if (blocked) {
      this.speaking = false;
      this.policy.enter('listening');
      this.gate.release(turn.turnId);
      return this.finish(turn.turnId, profile, 'unavailable', started, { reason: blocked });
    }
    try {
      const services = await this.services();
      const engine = this.policy.chooseSourceEngine(spoken, profile, services);
      const source = await this.synthesize(spoken, turn.turnId, engine, profile);
      if (this.gate.isCancelled(turn.turnId)) {
        return this.finish(turn.turnId, profile, 'cancelled', started, { sourceEngine: source.engine, sourceTtsMs: source.latencyMs });
      }
      let audio = source.audio;
      let mime = source.mime;
      let rvcMs: number | undefined;
      if (profile.usesRvc) {
        if (!profile.speakerId) {
          return this.finish(turn.turnId, profile, 'unavailable', started, {
            reason: `${profile.profileId} selected. ${profile.profileId} speech unavailable (no speaker mapping).`,
            sourceEngine: source.engine,
            sourceTtsMs: source.latencyMs,
          });
        }
        const converted = this.rvc
          ? await this.rvc.convert(audio, mime, profile.speakerId, turn.turnId)
          : await convertWithRvc(audio, mime, profile.speakerId, turn.turnId);
        if (this.gate.isCancelled(turn.turnId)) {
          return this.finish(turn.turnId, profile, 'cancelled', started, {
            sourceEngine: source.engine,
            sourceTtsMs: source.latencyMs,
            rvcMs: converted.latencyMs,
          });
        }
        audio = converted.audio;
        mime = converted.mime;
        rvcMs = converted.latencyMs;
      }
      if (!this.gate.isCurrent(turn.turnId)) {
        return this.finish(turn.turnId, profile, 'cancelled', started, {
          sourceEngine: source.engine,
          sourceTtsMs: source.latencyMs,
          rvcMs,
        });
      }
      return this.finish(turn.turnId, profile, 'spoken', started, {
        sourceEngine: source.engine,
        sourceTtsMs: source.latencyMs,
        rvcMs,
        mime,
        audioBase64: audio.toString('base64'),
        spokenProfileId: profile.profileId,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return this.finish(turn.turnId, profile, 'degraded', started, {
        reason: `${profile.profileId} selected. ${profile.profileId} speech unavailable (${detail}).`,
      });
    } finally {
      this.speaking = false;
      this.policy.enter('listening');
      this.gate.release(turn.turnId);
    }
  }

  public async cancel(turnId: string): Promise<void> {
    this.gate.cancel(turnId);
    this.speaking = false;
    this.policy.enter('listening');
    await Promise.allSettled([
      this.synthesizer?.cancel(turnId),
      cancelJaitts(turnId),
      this.rvc?.cancel(turnId) ?? cancelRvc(turnId),
    ]);
  }

  public resourcePolicy() {
    return this.policy.describe();
  }

  private async blockReason(profile: VoiceProfile): Promise<string | undefined> {
    if (profile.kind === 'native') {
      const probe = await this.probeProfile(profile.profileId);
      return probe.available ? undefined : probe.reason;
    }
    if (!this.consent.isCloneConsented(profile.profileId)) {
      return `${profile.profileId} selected. ${profile.profileId} speech unavailable (clone consent not granted for standalone).`;
    }
    if (!profile.speakerId) {
      return `${profile.profileId} selected. ${profile.profileId} speech unavailable (no standalone speaker mapping).`;
    }
    const rvc = this.policy.canUseRvc(profile, await this.services());
    if (!rvc.ok) return `${profile.profileId} selected. ${profile.profileId} speech unavailable (${rvc.reason}).`;
    return undefined;
  }

  private async synthesize(text: string, turnId: string, engine: SourceTtsEngine, profile: VoiceProfile) {
    if (this.synthesizer) return await this.synthesizer.synthesize(text, turnId, engine);
    if (engine === 'jaitts' && profile.speakerId) {
      return await synthesizeJaitts(text, profile.speakerId, turnId);
    }
    return await synthesizeEdgeTts(text, { turnId });
  }

  private async services() {
    if (this.probeServices) return await this.probeServices();
    const [jaitts, rvc] = await Promise.all([probeJaitts(), probeRvc()]);
    return {
      qwenLoaded: true,
      asrReachable: true,
      jaittsReady: jaitts.ready,
      rvcReady: rvc.ready,
    };
  }

  private finish(
    turnId: string,
    profile: VoiceProfile,
    status: VoiceOutputResult['status'],
    started: number,
    extra: Partial<VoiceOutputResult> & { sourceEngine?: SourceTtsEngine; sourceTtsMs?: number; rvcMs?: number } = {},
  ): VoiceOutputResult {
    return {
      status,
      turnId,
      profileId: profile.profileId,
      fallback: false,
      timings: {
        totalMs: Date.now() - started,
        sourceTtsMs: extra.sourceTtsMs,
        rvcMs: extra.rvcMs,
        sourceEngine: extra.sourceEngine,
      },
      resourcePhase: 'listening',
      spokenProfileId: extra.spokenProfileId,
      reason: extra.reason,
      mime: extra.mime,
      audioBase64: extra.audioBase64,
    };
  }
}

export function defaultJarvisVoiceProfile(): VoiceProfile {
  return resolveVoiceRoute(JARVIS_VOICE_ID);
}

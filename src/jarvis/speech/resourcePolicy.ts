import type { SourceTtsEngine, VoiceProfile, VoiceResourcePhase } from './types';
import { shouldUseJaitts } from './shouldUseJaitts';

export type VoiceServiceSnapshot = {
  qwenLoaded: boolean;
  asrReachable: boolean;
  jaittsReady: boolean;
  rvcReady: boolean;
  freeVramMiB?: number;
};

/**
 * Standalone voice GPU policy.
 * Prefer keeping Qwen warm. Do not start or force-unload heavy processes.
 * JaiTTS remains a longer-form clone source only when already resident.
 */
export class StandaloneVoiceResourcePolicy {
  private phase: VoiceResourcePhase = 'listening';

  public getPhase(): VoiceResourcePhase {
    return this.phase;
  }

  public enter(phase: VoiceResourcePhase): VoiceResourcePhase {
    this.phase = phase;
    return this.phase;
  }

  public chooseSourceEngine(
    text: string,
    profile: VoiceProfile,
    services: VoiceServiceSnapshot,
  ): SourceTtsEngine {
    if (profile.kind === 'native') return 'edge';
    if (services.jaittsReady && shouldUseJaitts(text)) return 'jaitts';
    return 'edge';
  }

  public canUseRvc(profile: VoiceProfile, services: VoiceServiceSnapshot): { ok: boolean; reason?: string } {
    if (!profile.usesRvc) return { ok: true };
    if (!services.rvcReady) return { ok: false, reason: `${profile.profileId} RVC is not running.` };
    return { ok: true };
  }

  public describe(): {
    phase: VoiceResourcePhase;
    qwen: 'keep-warm';
    asr: 'keep';
    jaitts: 'optional-if-already-resident';
    rvc: 'clone-only-if-already-resident';
    unload: 'none';
  } {
    return {
      phase: this.phase,
      qwen: 'keep-warm',
      asr: 'keep',
      jaitts: 'optional-if-already-resident',
      rvc: 'clone-only-if-already-resident',
      unload: 'none',
    };
  }
}

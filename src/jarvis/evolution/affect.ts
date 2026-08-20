export type AffectState = {
  valence: number;
  arousal: number;
  dominance: number;
  trust: number;
  familiarity: number;
  confidence: number;
  socialEnergy: number;
};

export type AffectStyle = {
  warmth: number;
  humor: number;
  enthusiasm: number;
  directness: number;
  formality: number;
  responseLength: 'short' | 'medium' | 'long';
  voiceEnergy: 'low' | 'medium' | 'high';
};

const BASELINE: AffectState = {
  valence: 0.15,
  arousal: 0.2,
  dominance: 0.35,
  trust: 0.5,
  familiarity: 0.4,
  confidence: 0.45,
  socialEnergy: 0.4,
};

function clamp(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export class AffectEngine {
  private state: AffectState = { ...BASELINE };

  public snapshot(): AffectState {
    return { ...this.state };
  }

  public appraise(event: {
    kind: 'success' | 'failure' | 'owner_correction' | 'social' | 'idle';
    intensity?: number;
  }): AffectState {
    const intensity = Math.min(1, Math.max(0.05, event.intensity ?? 0.2));
    if (event.kind === 'success') {
      this.state.valence = clamp(this.state.valence + 0.15 * intensity);
      this.state.confidence = clamp01(this.state.confidence + 0.08 * intensity);
      this.state.arousal = clamp01(this.state.arousal + 0.05 * intensity);
    } else if (event.kind === 'failure') {
      this.state.valence = clamp(this.state.valence - 0.12 * intensity);
      this.state.confidence = clamp01(this.state.confidence - 0.06 * intensity);
      this.state.arousal = clamp01(this.state.arousal + 0.08 * intensity);
    } else if (event.kind === 'owner_correction') {
      this.state.trust = clamp01(this.state.trust + 0.04 * intensity);
      this.state.confidence = clamp01(this.state.confidence - 0.03 * intensity);
    } else if (event.kind === 'social') {
      this.state.socialEnergy = clamp01(this.state.socialEnergy + 0.1 * intensity);
      this.state.familiarity = clamp01(this.state.familiarity + 0.05 * intensity);
    }
    return this.snapshot();
  }

  public decay(steps = 1): AffectState {
    for (let i = 0; i < steps; i += 1) {
      for (const key of Object.keys(this.state) as Array<keyof AffectState>) {
        const current = this.state[key];
        const target = BASELINE[key];
        this.state[key] = current + (target - current) * 0.18;
      }
    }
    return this.snapshot();
  }

  public style(): AffectStyle {
    const { valence, arousal, dominance, socialEnergy } = this.state;
    return {
      warmth: clamp01(0.5 + valence * 0.4 + socialEnergy * 0.1),
      humor: clamp01(0.35 + valence * 0.25 + arousal * 0.1),
      enthusiasm: clamp01(0.3 + arousal * 0.5 + valence * 0.2),
      directness: clamp01(0.45 + dominance * 0.4),
      formality: clamp01(0.4 - valence * 0.1 + dominance * 0.15),
      responseLength: arousal > 0.65 ? 'long' : arousal < 0.2 ? 'short' : 'medium',
      voiceEnergy: arousal > 0.6 ? 'high' : arousal < 0.25 ? 'low' : 'medium',
    };
  }
}

export function affectCannotAuthorize(_style: AffectStyle): true {
  return true;
}

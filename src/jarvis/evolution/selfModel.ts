export type CompetenceTrend = 'improving' | 'stable' | 'declining' | 'insufficient_data';

export type CapabilityAssessment = {
  capability: string;
  confidence: number | null;
  attempts: number;
  successes: number;
  partials: number;
  failures: number;
  recentTrend: CompetenceTrend;
  recurringWeaknesses: string[];
  lastEvaluated: string;
};

export class CapabilitySelfModel {
  private readonly byId = new Map<string, CapabilityAssessment>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  public observe(capability: string, outcome: 'success' | 'partial' | 'failure', weakness?: string): CapabilityAssessment {
    const current = this.byId.get(capability) ?? {
      capability,
      confidence: null,
      attempts: 0,
      successes: 0,
      partials: 0,
      failures: 0,
      recentTrend: 'insufficient_data' as const,
      recurringWeaknesses: [],
      lastEvaluated: new Date(this.now()).toISOString(),
    };
    current.attempts += 1;
    if (outcome === 'success') current.successes += 1;
    if (outcome === 'partial') current.partials += 1;
    if (outcome === 'failure') current.failures += 1;
    if (weakness && !current.recurringWeaknesses.includes(weakness)) {
      current.recurringWeaknesses = [...current.recurringWeaknesses, weakness].slice(-6);
    }
    current.lastEvaluated = new Date(this.now()).toISOString();
    if (current.attempts < 3) {
      current.confidence = null;
      current.recentTrend = 'insufficient_data';
    } else {
      current.confidence = current.successes / current.attempts;
      const recentRatio = current.successes / current.attempts;
      current.recentTrend = recentRatio >= 0.75 ? 'improving' : recentRatio <= 0.4 ? 'declining' : 'stable';
    }
    this.byId.set(capability, current);
    return { ...current, recurringWeaknesses: [...current.recurringWeaknesses] };
  }

  public get(capability: string): CapabilityAssessment | undefined {
    const item = this.byId.get(capability);
    return item ? { ...item, recurringWeaknesses: [...item.recurringWeaknesses] } : undefined;
  }

  public matrix(): CapabilityAssessment[] {
    return [...this.byId.values()].map(item => ({ ...item, recurringWeaknesses: [...item.recurringWeaknesses] }));
  }
}

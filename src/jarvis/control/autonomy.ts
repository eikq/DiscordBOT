export const AUTONOMY_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  0: 'Answer only',
  1: 'Read-only tools',
  2: 'Safe reversible actions',
  3: 'Scoped task actions with lease',
  4: 'Proactive authorized automation',
  5: 'Experimental candidate self-improvement',
};

export type OwnerControlState = {
  maxAutonomy: AutonomyLevel;
  currentAutonomy: AutonomyLevel;
  researchDepth: 'none' | 'quick' | 'standard' | 'deep' | 'forensic';
  backgroundEvolution: boolean;
  nightCycle: boolean;
  proactiveAlerts: boolean;
  simulationMode: boolean;
};

export const DEFAULT_OWNER_CONTROL: OwnerControlState = {
  maxAutonomy: 2,
  currentAutonomy: 1,
  researchDepth: 'standard',
  backgroundEvolution: false,
  nightCycle: false,
  proactiveAlerts: true,
  simulationMode: false,
};

export class OwnerControl {
  constructor(private state: OwnerControlState = { ...DEFAULT_OWNER_CONTROL }) {}

  public snapshot(): OwnerControlState {
    return { ...this.state };
  }

  public setMaxAutonomy(level: AutonomyLevel, actor: 'owner' | 'jarvis'): OwnerControlState {
    if (actor !== 'owner') {
      throw Object.assign(new Error('Jarvis cannot raise its own maximum autonomy.'), { reasonCode: 'CAPABILITY_DENIED' });
    }
    this.state.maxAutonomy = level;
    if (this.state.currentAutonomy > level) this.state.currentAutonomy = level;
    return this.snapshot();
  }

  public setCurrentAutonomy(level: AutonomyLevel, actor: 'owner' | 'jarvis'): OwnerControlState {
    if (actor === 'jarvis' && level > this.state.currentAutonomy) {
      throw Object.assign(new Error('Jarvis cannot increase its autonomy.'), { reasonCode: 'CAPABILITY_DENIED' });
    }
    this.state.currentAutonomy = Math.min(level, this.state.maxAutonomy) as AutonomyLevel;
    return this.snapshot();
  }

  public patch(update: Partial<Omit<OwnerControlState, 'maxAutonomy' | 'currentAutonomy'>>, actor: 'owner' | 'jarvis'): OwnerControlState {
    if (actor !== 'owner' && update.simulationMode === false) {
      throw Object.assign(new Error('Only the owner can disable simulation mode.'), { reasonCode: 'CAPABILITY_DENIED' });
    }
    if (actor !== 'owner' && (update.backgroundEvolution || update.nightCycle)) {
      throw Object.assign(new Error('Only the owner can enable background evolution.'), { reasonCode: 'CAPABILITY_DENIED' });
    }
    this.state = { ...this.state, ...update };
    return this.snapshot();
  }
}

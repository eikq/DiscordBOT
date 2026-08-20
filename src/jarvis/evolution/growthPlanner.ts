export type GrowthGoal = {
  id: string;
  title: string;
  evidence: string;
  practice: string;
  metric: string;
  successCondition: string;
  active: boolean;
};

const MAX_ACTIVE = 3;

export class GrowthPlanner {
  private readonly goals: GrowthGoal[] = [];

  public propose(goal: Omit<GrowthGoal, 'active'>): GrowthGoal {
    const activeCount = this.goals.filter(item => item.active).length;
    const next: GrowthGoal = { ...goal, active: activeCount < MAX_ACTIVE };
    this.goals.push(next);
    return { ...next };
  }

  public activate(id: string): GrowthGoal {
    const goal = this.goals.find(item => item.id === id);
    if (!goal) throw Object.assign(new Error('Unknown growth goal.'), { reasonCode: 'PLAN_INVALID' });
    if (!goal.active && this.goals.filter(item => item.active).length >= MAX_ACTIVE) {
      throw Object.assign(new Error('Only a small number of growth goals may be active.'), { reasonCode: 'BUDGET_EXCEEDED' });
    }
    goal.active = true;
    return { ...goal };
  }

  public deactivate(id: string): GrowthGoal {
    const goal = this.goals.find(item => item.id === id);
    if (!goal) throw Object.assign(new Error('Unknown growth goal.'), { reasonCode: 'PLAN_INVALID' });
    goal.active = false;
    return { ...goal };
  }

  public active(): GrowthGoal[] {
    return this.goals.filter(item => item.active).map(item => ({ ...item }));
  }

  public list(): GrowthGoal[] {
    return this.goals.map(item => ({ ...item }));
  }
}

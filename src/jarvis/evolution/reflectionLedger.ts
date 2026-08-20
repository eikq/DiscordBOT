import type { JsonCollection } from './persistTypes';
import type { ReflectionRecord } from './reflectionEngine';

export class ReflectionLedger {
  private readonly items: ReflectionRecord[] = [];

  constructor(private readonly persist?: JsonCollection<ReflectionRecord>) {
    if (persist) this.items.push(...persist.load());
  }

  public add(record: ReflectionRecord): ReflectionRecord {
    const existing = this.find(record.experienceId, record.trigger);
    if (existing) return existing;
    const next = { ...record };
    this.items.push(next);
    this.persist?.replace(this.list());
    return { ...next };
  }

  public find(experienceId: string, trigger?: ReflectionRecord['trigger']): ReflectionRecord | undefined {
    return this.items.find(item => (
      item.experienceId === experienceId && (trigger === undefined || item.trigger === trigger)
    ));
  }

  public list(): ReflectionRecord[] {
    return this.items.map(item => ({ ...item }));
  }
}

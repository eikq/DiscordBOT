import type { JsonCollection } from './persistTypes';
import type { ReflectionRecord } from './reflectionEngine';

export class ReflectionLedger {
  private readonly items: ReflectionRecord[] = [];

  constructor(private readonly persist?: JsonCollection<ReflectionRecord>) {
    if (persist) this.items.push(...persist.load());
  }

  public add(record: ReflectionRecord): ReflectionRecord {
    const next = { ...record };
    this.items.push(next);
    this.persist?.replace(this.list());
    return { ...next };
  }

  public list(): ReflectionRecord[] {
    return this.items.map(item => ({ ...item }));
  }
}

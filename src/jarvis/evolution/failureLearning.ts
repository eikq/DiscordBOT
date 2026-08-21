import { failureSignature } from '../agent/recovery';
import type { JarvisErrorCode } from '../ops/types';
import type { JsonCollection } from './persistTypes';
import type { ExperienceRecord } from './types';
import type { ObjectiveBlockerCode } from '../intelligence/types';

export type FailureRecord = {
  signature: string;
  count: number;
  lastAt: string;
  domain?: string;
  tool?: string;
  errorClass: string;
  stage?: string;
  blocker?: ObjectiveBlockerCode;
  nextPossibleStep?: string;
};

export type WeaknessSignal = {
  key: string;
  capability?: string;
  blocker?: ObjectiveBlockerCode;
  count: number;
  nextPossibleStep?: string;
};

export class FailureLedger {
  private readonly items = new Map<string, FailureRecord>();

  constructor(private readonly persist?: JsonCollection<FailureRecord>) {
    for (const item of persist?.load() ?? []) this.items.set(item.signature, item);
  }

  public record(
    experience: ExperienceRecord,
    errorClass: JarvisErrorCode | string = 'STEP_FAILED',
    context: { blocker?: ObjectiveBlockerCode; nextPossibleStep?: string } = {},
  ): FailureRecord {
    const signature = failureSignature({
      domain: experience.domain,
      tool: experience.tools[0],
      errorClass,
      stage: experience.kind,
      symptoms: experience.cause || experience.result,
    });
    const existing = this.items.get(signature);
    const next: FailureRecord = {
      signature,
      count: (existing?.count ?? 0) + 1,
      lastAt: experience.createdAt,
      domain: experience.domain,
      tool: experience.tools[0],
      errorClass: String(errorClass),
      stage: experience.kind,
      blocker: context.blocker ?? experience.failureAnalysis?.blocker as ObjectiveBlockerCode | undefined,
      nextPossibleStep: context.nextPossibleStep ?? experience.failureAnalysis?.nextPossibleStep,
    };
    this.items.set(signature, next);
    this.persist?.replace(this.list());
    return { ...next };
  }

  public recurring(minCount = 2): FailureRecord[] {
    return [...this.items.values()].filter(item => item.count >= minCount).map(item => ({ ...item }));
  }

  public get(signature: string): FailureRecord | undefined {
    const item = this.items.get(signature);
    return item ? { ...item } : undefined;
  }

  public list(): FailureRecord[] {
    return [...this.items.values()].map(item => ({ ...item }));
  }

  public weaknessSignals(minCount = 2): WeaknessSignal[] {
    const grouped = new Map<string, WeaknessSignal>();
    for (const item of this.items.values()) {
      const key = `${item.tool || 'unknown'}:${item.blocker || item.errorClass}`;
      const current = grouped.get(key);
      grouped.set(key, {
        key,
        capability: item.tool,
        blocker: item.blocker,
        count: (current?.count ?? 0) + item.count,
        nextPossibleStep: item.nextPossibleStep ?? current?.nextPossibleStep,
      });
    }
    return [...grouped.values()].filter(item => item.count >= minCount);
  }
}

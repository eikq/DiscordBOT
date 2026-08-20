import { failureSignature } from '../agent/recovery';
import type { JarvisErrorCode } from '../ops/types';
import type { ExperienceRecord } from './types';

export type FailureRecord = {
  signature: string;
  count: number;
  lastAt: string;
  domain?: string;
  tool?: string;
  errorClass: string;
  stage?: string;
};

export class FailureLedger {
  private readonly items = new Map<string, FailureRecord>();

  public record(experience: ExperienceRecord, errorClass: JarvisErrorCode | string = 'STEP_FAILED'): FailureRecord {
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
    };
    this.items.set(signature, next);
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
}

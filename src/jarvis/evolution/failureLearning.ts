import { failureSignature } from '../agent/recovery';
import type { JarvisErrorCode } from '../ops/types';
import type { JsonCollection } from './persistTypes';
import type { ExperienceRecord, FailureKnowledgeKind } from './types';
import { classifyFailureKnowledge } from './failureKinds';

export type FailureRecord = {
  signature: string;
  count: number;
  lastAt: string;
  domain?: string;
  tool?: string;
  errorClass: string;
  stage?: string;
  kind: FailureKnowledgeKind;
};

export class FailureLedger {
  private readonly items = new Map<string, FailureRecord>();

  constructor(private readonly persist?: JsonCollection<FailureRecord>) {
    for (const item of persist?.load() ?? []) {
      this.items.set(item.signature, {
        ...item,
        kind: item.kind ?? classifyFailureKnowledge(item.errorClass),
      });
    }
  }

  public record(experience: ExperienceRecord, errorClass: JarvisErrorCode | string = 'STEP_FAILED'): FailureRecord {
    const kind = experience.failureKind ?? classifyFailureKnowledge(errorClass, experience.cause);
    const signature = failureSignature({
      domain: experience.domain,
      tool: experience.tools[0],
      errorClass: kind,
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
      kind,
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
}

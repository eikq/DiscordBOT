import type { ModelCapability, ModelCertification, ModelCertificationState } from './types';

export class ModelCertificationRegistry {
  private readonly records = new Map<string, ModelCertification>();

  public record(certification: ModelCertification): void {
    if (!certification.modelId.trim()) throw new Error('Certification requires a model id.');
    if (certification.state === 'PASS' && certification.evidence.length === 0) {
      throw new Error('PASS certification requires objective evidence.');
    }
    this.records.set(key(certification.modelId, certification.capability), clone(certification));
  }

  public get(modelId: string, capability: ModelCapability): ModelCertification {
    const record = this.records.get(key(modelId, capability));
    return record ? clone(record) : {
      modelId,
      capability,
      state: 'NOT_TESTED',
      evidence: [],
    };
  }

  public state(modelId: string, capability: ModelCapability): ModelCertificationState {
    return this.get(modelId, capability).state;
  }

  public list(modelId?: string): ModelCertification[] {
    return [...this.records.values()]
      .filter(item => !modelId || item.modelId === modelId)
      .map(clone);
  }
}

function key(modelId: string, capability: ModelCapability): string {
  return `${modelId}\u0000${capability}`;
}

function clone(value: ModelCertification): ModelCertification {
  return { ...value, evidence: [...value.evidence] };
}

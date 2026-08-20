export const MODEL_ADAPTATION_ORDER = [
  'CONTEXT',
  'RETRIEVAL',
  'MEMORY',
  'SKILLS',
  'POLICY',
  'OPTIONAL_LORA',
] as const;

export type ModelAdaptationLayer = (typeof MODEL_ADAPTATION_ORDER)[number];

export type DatasetVersion = {
  id: string;
  createdAt: string;
  description: string;
  records: number;
  containsSecrets: false;
};

export type TrainingCandidate = {
  id: string;
  datasetId: string;
  parentBaselineId?: string;
  status: 'proposed' | 'evaluated' | 'rejected' | 'owner_ab' | 'rolled_back';
  trained: false;
};

export type BaselineEvaluation = {
  id: string;
  at: string;
  score: number | null;
  insufficientData: boolean;
};

export type CandidateEvaluation = {
  candidateId: string;
  baselineId: string;
  score: number | null;
  improved: boolean;
};

export type PromotionDecision = {
  candidateId: string;
  decidedBy: 'owner';
  promote: boolean;
};

export type RollbackTarget = {
  baselineId: string;
};

export class ModelAdaptationRegistry {
  private readonly datasets: DatasetVersion[] = [];
  private readonly candidates: TrainingCandidate[] = [];

  public registerDataset(description: string, records: number): DatasetVersion {
    const dataset: DatasetVersion = {
      id: `ds_${this.datasets.length + 1}`,
      createdAt: new Date().toISOString(),
      description,
      records,
      containsSecrets: false,
    };
    this.datasets.push(dataset);
    return { ...dataset };
  }

  public proposeCandidate(datasetId: string, parentBaselineId?: string): TrainingCandidate {
    const candidate: TrainingCandidate = {
      id: `train_${this.candidates.length + 1}`,
      datasetId,
      parentBaselineId,
      status: 'proposed',
      trained: false,
    };
    this.candidates.push(candidate);
    return { ...candidate };
  }

  public evaluate(candidateId: string, baseline: BaselineEvaluation, candidateScore: number | null): CandidateEvaluation {
    const candidate = this.candidates.find(item => item.id === candidateId);
    if (!candidate) throw Object.assign(new Error('Unknown training candidate.'), { reasonCode: 'CANDIDATE_REJECTED' });
    const improved = candidateScore !== null && baseline.score !== null && candidateScore > baseline.score;
    candidate.status = improved ? 'evaluated' : 'rejected';
    return {
      candidateId,
      baselineId: baseline.id,
      score: candidateScore,
      improved,
    };
  }

  public ownerDecision(candidateId: string, promote: boolean): PromotionDecision {
    const candidate = this.candidates.find(item => item.id === candidateId);
    if (!candidate) throw Object.assign(new Error('Unknown training candidate.'), { reasonCode: 'CANDIDATE_REJECTED' });
    candidate.status = promote ? 'owner_ab' : 'rejected';
    return { candidateId, decidedBy: 'owner', promote };
  }

  public nextLayer(current: ModelAdaptationLayer): ModelAdaptationLayer | null {
    const index = MODEL_ADAPTATION_ORDER.indexOf(current);
    return MODEL_ADAPTATION_ORDER[index + 1] ?? null;
  }

  public list(): TrainingCandidate[] {
    return this.candidates.map(item => ({ ...item }));
  }
}

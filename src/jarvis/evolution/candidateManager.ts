import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { assertIsolated, rejectProductionWrite } from './candidateSandbox';

export const CANDIDATE_STATUSES = [
  'CREATED',
  'TESTING',
  'FAILED',
  'REJECTED',
  'PROMOTION_CANDIDATE',
  'ARCHIVED',
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export type ImprovementCandidate = {
  id: string;
  parent?: string;
  hypothesis: string;
  filesChanged: string[];
  sandboxPath: string;
  benchmarkBefore: number | null;
  benchmarkAfter: number | null;
  testResults: string;
  securityResults: string;
  resourceEstimate: string;
  status: CandidateStatus;
  simulated?: boolean;
};

export class CandidateManager {
  private readonly items = new Map<string, ImprovementCandidate>();

  public create(input: {
    hypothesis: string;
    sandboxPath: string;
    parent?: string;
    filesChanged?: string[];
    simulated?: boolean;
  }): ImprovementCandidate {
    assertIsolated(input.sandboxPath);
    for (const file of input.filesChanged ?? []) {
      const resolved = path.resolve(file);
      if (!resolved.startsWith(path.resolve(input.sandboxPath))) {
        rejectProductionWrite(file);
      }
    }
    const candidate: ImprovementCandidate = {
      id: `cand_${randomBytes(6).toString('hex')}`,
      parent: input.parent,
      hypothesis: input.hypothesis,
      filesChanged: input.filesChanged ?? [],
      sandboxPath: input.sandboxPath,
      benchmarkBefore: null,
      benchmarkAfter: null,
      testResults: 'not_run',
      securityResults: 'not_run',
      resourceEstimate: 'unknown',
      status: 'CREATED',
      simulated: input.simulated,
    };
    this.items.set(candidate.id, candidate);
    return { ...candidate };
  }

  public evaluate(id: string, input: {
    benchmarkBefore: number;
    benchmarkAfter: number;
    testsPassed: boolean;
    securityPassed: boolean;
  }): ImprovementCandidate {
    const candidate = this.require(id);
    candidate.status = 'TESTING';
    candidate.benchmarkBefore = input.benchmarkBefore;
    candidate.benchmarkAfter = input.benchmarkAfter;
    candidate.testResults = input.testsPassed ? 'pass' : 'fail';
    candidate.securityResults = input.securityPassed ? 'pass' : 'fail';
    if (!input.testsPassed || !input.securityPassed) {
      candidate.status = 'FAILED';
    } else if (input.benchmarkAfter <= input.benchmarkBefore) {
      candidate.status = 'REJECTED';
    } else {
      candidate.status = 'PROMOTION_CANDIDATE';
    }
    return { ...candidate };
  }

  public archive(id: string): ImprovementCandidate {
    const candidate = this.require(id);
    candidate.status = 'ARCHIVED';
    return { ...candidate };
  }

  public get(id: string): ImprovementCandidate | undefined {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  public list(): ImprovementCandidate[] {
    return [...this.items.values()].map(item => ({ ...item }));
  }

  public productionPromotionAllowed(): false {
    return false;
  }

  private require(id: string): ImprovementCandidate {
    const item = this.items.get(id);
    if (!item) throw Object.assign(new Error('Unknown candidate.'), { reasonCode: 'CANDIDATE_REJECTED' });
    return item;
  }
}

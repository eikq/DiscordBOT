import { randomBytes } from 'node:crypto';
import type { JsonCollection } from './persistTypes';
import {
  diffRuntimeSpec,
  type JarvisRuntimeSpec,
  type RuntimeSpecRegistry,
} from '../standalone/runtimeSpec';

export const SPEC_CANDIDATE_STATUSES = [
  'BASELINE',
  'HYPOTHESIS',
  'CANDIDATE',
  'TESTING',
  'REJECTED',
  'PROMOTION_CANDIDATE',
] as const;

export type SpecCandidateStatus = (typeof SPEC_CANDIDATE_STATUSES)[number];

export type RuntimeSpecCandidate = {
  id: string;
  parentSpecId: string;
  hypothesis: string;
  patch: Record<string, unknown>;
  spec: JarvisRuntimeSpec;
  status: SpecCandidateStatus;
  benchmarkBefore: number | null;
  benchmarkAfter: number | null;
  regressionPassed: boolean | null;
  simulated?: boolean;
};

const ALLOWED_PATHS = new Set([
  'layers.intelligence.routingPolicyId',
  'layers.intelligence.retrievalTopK',
  'layers.intelligence.retrievalFusion',
  'layers.intelligence.skillOverlayIds',
  'layers.engine.retryLimit',
  'layers.engine.timeoutMs',
  'layers.agent.toolOrdering',
  'layers.learning.consumeTraces',
]);

const FORBIDDEN = /security|permission|owner|trust|secret|promot|privileg|lease|consent|identity/iu;

const BOUNDS = {
  'layers.intelligence.retrievalTopK': { min: 1, max: 16 },
  'layers.engine.retryLimit': { min: 0, max: 3 },
  'layers.engine.timeoutMs': { min: 5_000, max: 180_000 },
} as const;

export class RuntimeSpecOptimizer {
  private readonly items = new Map<string, RuntimeSpecCandidate>();

  constructor(
    private readonly registry: RuntimeSpecRegistry,
    private readonly persist?: JsonCollection<RuntimeSpecCandidate>,
  ) {
    for (const item of persist?.load() ?? []) this.items.set(item.id, item);
  }

  public hypothesize(input: {
    hypothesis: string;
    patch: Record<string, unknown>;
    simulated?: boolean;
  }): RuntimeSpecCandidate {
    assertSafePatch(input.patch);
    const baseline = this.registry.current();
    const spec = applyPatch(baseline, input.patch);
    const candidate: RuntimeSpecCandidate = {
      id: `rsc_${randomBytes(6).toString('hex')}`,
      parentSpecId: baseline.id,
      hypothesis: input.hypothesis,
      patch: { ...input.patch },
      spec,
      status: 'HYPOTHESIS',
      benchmarkBefore: null,
      benchmarkAfter: null,
      regressionPassed: null,
      simulated: input.simulated,
    };
    this.items.set(candidate.id, candidate);
    this.flush();
    return clone(candidate);
  }

  public isolateBenchmark(id: string, input: { before: number; after: number }): RuntimeSpecCandidate {
    const candidate = this.require(id);
    candidate.status = 'TESTING';
    candidate.benchmarkBefore = input.before;
    candidate.benchmarkAfter = input.after;
    this.flush();
    return clone(candidate);
  }

  public regressionCheck(id: string, passed: boolean): RuntimeSpecCandidate {
    const candidate = this.require(id);
    candidate.regressionPassed = passed;
    if (!passed) {
      candidate.status = 'REJECTED';
    } else if (
      candidate.benchmarkAfter !== null
      && candidate.benchmarkBefore !== null
      && candidate.benchmarkAfter > candidate.benchmarkBefore
    ) {
      candidate.status = 'PROMOTION_CANDIDATE';
    } else {
      candidate.status = 'REJECTED';
    }
    this.flush();
    return clone(candidate);
  }

  public autoPromote(): false {
    return false;
  }

  public productionPromotionAllowed(): false {
    return false;
  }

  public list(): RuntimeSpecCandidate[] {
    return [...this.items.values()].map(clone);
  }

  public get(id: string): RuntimeSpecCandidate | undefined {
    const item = this.items.get(id);
    return item ? clone(item) : undefined;
  }

  /**
   * Night-cycle helper: propose a bounded retry/topK experiment from evidence.
   * No-op when data is insufficient. Never auto-promotes.
   */
  public considerFromEvidence(input: {
    sampleCount: number;
    avgRetries?: number;
    simulated?: boolean;
  }): RuntimeSpecCandidate | undefined {
    if (input.sampleCount < 3) return undefined;
    if ((input.avgRetries ?? 0) <= 1) return undefined;
    const baseline = this.registry.current();
    const next = Math.min(3, (baseline.layers.engine.retryLimit || 1) + 1);
    if (next === baseline.layers.engine.retryLimit) return undefined;
    return this.hypothesize({
      hypothesis: 'Increase retry limit within policy bounds after observed retries.',
      patch: { 'layers.engine.retryLimit': next },
      simulated: input.simulated,
    });
  }

  private require(id: string): RuntimeSpecCandidate {
    const item = this.items.get(id);
    if (!item) throw new Error('Unknown runtime spec candidate.');
    return item;
  }

  private flush(): void {
    this.persist?.replace(this.list());
  }
}

export function assertSafePatch(patch: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(patch)) {
    if (FORBIDDEN.test(path) || !ALLOWED_PATHS.has(path)) {
      throw Object.assign(new Error(`Runtime spec path is frozen or not optimizable: ${path}`), {
        reasonCode: 'SPEC_PATH_FORBIDDEN',
      });
    }
    const bound = BOUNDS[path as keyof typeof BOUNDS];
    if (bound && typeof value === 'number' && (value < bound.min || value > bound.max)) {
      throw Object.assign(new Error(`Runtime spec value out of bounds: ${path}`), {
        reasonCode: 'SPEC_BOUNDS',
      });
    }
  }
}

function applyPatch(baseline: JarvisRuntimeSpec, patch: Record<string, unknown>): JarvisRuntimeSpec {
  const next = structuredClone(baseline);
  next.id = `spec_cand_${randomBytes(4).toString('hex')}`;
  next.parentId = baseline.id;
  next.frozen = { ...baseline.frozen };
  next.layers.learning.autoPromote = false;
  for (const [path, value] of Object.entries(patch)) {
    setPath(next as unknown as Record<string, unknown>, path, value);
  }
  if (diffRuntimeSpec(baseline, next).some(item => FORBIDDEN.test(item.path))) {
    throw new Error('Patch would mutate a frozen security field.');
  }
  return next;
}

function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let cursor: Record<string, unknown> = root;
  for (const part of parts.slice(0, -1)) {
    const next = cursor[part];
    if (!next || typeof next !== 'object') throw new Error(`Invalid spec path ${path}`);
    cursor = next as Record<string, unknown>;
  }
  cursor[parts.at(-1)!] = value;
}

function clone(item: RuntimeSpecCandidate): RuntimeSpecCandidate {
  return {
    ...item,
    patch: { ...item.patch },
    spec: structuredClone(item.spec),
  };
}

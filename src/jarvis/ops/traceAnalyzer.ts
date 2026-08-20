import type { JarvisTraceRecord } from './traceTypes';

export const ANALYZER_INSUFFICIENT = 'INSUFFICIENT_DATA' as const;

export type AnalyzerDimension = 'model' | 'route' | 'capability' | 'skill' | 'memory' | 'failure';

export type AnalyzerBucket = {
  key: string;
  samples: number;
  successRate?: number;
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  tokens?: number;
  tokensPerSec?: number;
  retries?: number;
};

export type AnalyzerReport = {
  status: 'ok' | typeof ANALYZER_INSUFFICIENT;
  reason?: string;
  sampleCount: number;
  dimension: AnalyzerDimension;
  buckets: AnalyzerBucket[];
};

const MIN_RATE = 3;
const MIN_PERCENTILE = 5;

/**
 * Evidence-backed operational statistics. Returns INSUFFICIENT_DATA rather
 * than inventing p50/p95, success rates, or hardware metrics.
 */
export class TraceAnalyzer {
  public summarize(traces: JarvisTraceRecord[], dimension: AnalyzerDimension): AnalyzerReport {
    if (traces.length === 0) {
      return {
        status: ANALYZER_INSUFFICIENT,
        reason: 'No traces recorded.',
        sampleCount: 0,
        dimension,
        buckets: [],
      };
    }
    const groups = new Map<string, JarvisTraceRecord[]>();
    for (const trace of traces) {
      for (const key of keysOf(trace, dimension)) {
        const list = groups.get(key) ?? [];
        list.push(trace);
        groups.set(key, list);
      }
    }
    if (groups.size === 0) {
      return {
        status: ANALYZER_INSUFFICIENT,
        reason: `No ${dimension} labels on traces.`,
        sampleCount: traces.length,
        dimension,
        buckets: [],
      };
    }
    const buckets = [...groups.entries()].map(([key, items]) => bucketOf(key, items));
    const anyEvidence = buckets.some(item => item.samples >= MIN_RATE);
    if (!anyEvidence) {
      return {
        status: ANALYZER_INSUFFICIENT,
        reason: `Need at least ${MIN_RATE} samples per ${dimension} bucket.`,
        sampleCount: traces.length,
        dimension,
        buckets,
      };
    }
    return { status: 'ok', sampleCount: traces.length, dimension, buckets };
  }
}

function keysOf(trace: JarvisTraceRecord, dimension: AnalyzerDimension): string[] {
  if (dimension === 'model') return trace.modelProfileId ? [trace.modelProfileId] : [];
  if (dimension === 'route') return trace.route ? [trace.route] : [];
  if (dimension === 'capability') return trace.capabilities ?? [];
  if (dimension === 'skill') return trace.skillRefs ?? [];
  if (dimension === 'memory') return (trace.memoryRefs?.length ?? 0) > 0 ? ['retrieved'] : ['none'];
  if (dimension === 'failure') {
    if (trace.success === false || (trace.errors && trace.errors.length > 0)) {
      return trace.errors?.map(item => item.code || item.message) ?? ['unknown_failure'];
    }
    return [];
  }
  return [];
}

function bucketOf(key: string, items: JarvisTraceRecord[]): AnalyzerBucket {
  const latencies = items.map(item => item.totalLatencyMs).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const tokens = items.map(item => item.tokens).filter((value): value is number => typeof value === 'number');
  const tps = items.map(item => item.tokensPerSec).filter((value): value is number => typeof value === 'number');
  const retries = items.map(item => item.retryCount).filter((value): value is number => typeof value === 'number');
  const decided = items.filter(item => typeof item.success === 'boolean');
  const bucket: AnalyzerBucket = { key, samples: items.length };
  if (decided.length >= MIN_RATE) {
    bucket.successRate = decided.filter(item => item.success).length / decided.length;
  }
  if (latencies.length >= MIN_PERCENTILE) {
    const sorted = [...latencies].sort((a, b) => a - b);
    bucket.latencyP50Ms = percentile(sorted, 0.5);
    bucket.latencyP95Ms = percentile(sorted, 0.95);
  }
  if (tokens.length > 0) bucket.tokens = sum(tokens);
  if (tps.length >= MIN_RATE) bucket.tokensPerSec = avg(tps);
  if (retries.length > 0) bucket.retries = sum(retries);
  return bucket;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function avg(values: number[]): number {
  return sum(values) / values.length;
}

import { ANALYZER_INSUFFICIENT, type AnalyzerReport } from './traceAnalyzer';
import type { JarvisTraceRecord } from './traceTypes';

/**
 * Efficiency fields that may be recorded when actually measured.
 * Cloud must omit RAM/VRAM/CPU/GPU/energy/cost unless a probe supplied them.
 */
export type EfficiencySnapshot = {
  status: 'ok' | typeof ANALYZER_INSUFFICIENT;
  reason?: string;
  success?: number;
  latencyMs?: number;
  p50Ms?: number;
  p95Ms?: number;
  tokens?: number;
  tokensPerSec?: number;
  toolCalls?: number;
  retries?: number;
  ramBytes?: number;
  vramBytes?: number;
  cpuPct?: number;
  gpuPct?: number;
  energyJ?: number;
  cost?: number;
  sampleCount: number;
};

export type MeasuredHardware = {
  ramBytes?: number;
  vramBytes?: number;
  cpuPct?: number;
  gpuPct?: number;
  energyJ?: number;
  cost?: number;
};

export function efficiencyFromTraces(
  traces: JarvisTraceRecord[],
  hardware?: MeasuredHardware,
): EfficiencySnapshot {
  if (traces.length === 0) {
    return { status: ANALYZER_INSUFFICIENT, reason: 'No traces to measure.', sampleCount: 0 };
  }
  const decided = traces.filter(item => typeof item.success === 'boolean');
  const latencies = traces.map(item => item.totalLatencyMs).filter((value): value is number => typeof value === 'number');
  const tokens = traces.map(item => item.tokens).filter((value): value is number => typeof value === 'number');
  const tps = traces.map(item => item.tokensPerSec).filter((value): value is number => typeof value === 'number');
  const retries = traces.map(item => item.retryCount).filter((value): value is number => typeof value === 'number');
  const toolCalls = traces.reduce((acc, item) => acc + (item.toolResults?.length ?? 0), 0);
  const snapshot: EfficiencySnapshot = { status: 'ok', sampleCount: traces.length };
  if (decided.length >= 3) {
    snapshot.success = decided.filter(item => item.success).length / decided.length;
  }
  if (latencies.length > 0) {
    snapshot.latencyMs = latencies.reduce((acc, value) => acc + value, 0) / latencies.length;
  }
  if (latencies.length >= 5) {
    const sorted = [...latencies].sort((a, b) => a - b);
    snapshot.p50Ms = percentile(sorted, 0.5);
    snapshot.p95Ms = percentile(sorted, 0.95);
  }
  if (tokens.length > 0) snapshot.tokens = tokens.reduce((acc, value) => acc + value, 0);
  if (tps.length >= 3) snapshot.tokensPerSec = tps.reduce((acc, value) => acc + value, 0) / tps.length;
  if (toolCalls > 0) snapshot.toolCalls = toolCalls;
  if (retries.length > 0) snapshot.retries = retries.reduce((acc, value) => acc + value, 0);
  assignMeasured(snapshot, hardware);
  if (
    snapshot.success === undefined
    && snapshot.p50Ms === undefined
    && snapshot.tokens === undefined
    && snapshot.toolCalls === undefined
  ) {
    return {
      status: ANALYZER_INSUFFICIENT,
      reason: 'Traces lack success, latency percentiles, tokens, or tool counts.',
      sampleCount: traces.length,
    };
  }
  return snapshot;
}

export function analyzerHasMetrics(report: AnalyzerReport): boolean {
  return report.status === 'ok' && report.buckets.some(item => item.successRate !== undefined || item.latencyP50Ms !== undefined);
}

function assignMeasured(snapshot: EfficiencySnapshot, hardware?: MeasuredHardware): void {
  if (!hardware) return;
  if (typeof hardware.ramBytes === 'number') snapshot.ramBytes = hardware.ramBytes;
  if (typeof hardware.vramBytes === 'number') snapshot.vramBytes = hardware.vramBytes;
  if (typeof hardware.cpuPct === 'number') snapshot.cpuPct = hardware.cpuPct;
  if (typeof hardware.gpuPct === 'number') snapshot.gpuPct = hardware.gpuPct;
  if (typeof hardware.energyJ === 'number') snapshot.energyJ = hardware.energyJ;
  if (typeof hardware.cost === 'number') snapshot.cost = hardware.cost;
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

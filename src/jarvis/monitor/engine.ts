import {
  DEFAULT_MONITOR_PREFERENCES,
  importanceFromSeverity,
  monitorDedupKey,
  type MonitorDecision,
  type MonitorImportance,
  type MonitorPreferences,
  type MonitorSignal,
} from './types';

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 } as const;
const IMPORTANCE_RANK: Record<MonitorImportance, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

export class ProactiveMonitor {
  private readonly lastNotified = new Map<string, number>();
  private readonly pending: MonitorSignal[] = [];
  private readonly suppressed = new Set<string>();
  private readonly acknowledged = new Map<string, number>();

  constructor(
    private readonly preferences: MonitorPreferences = DEFAULT_MONITOR_PREFERENCES,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public ingest(signal: MonitorSignal): MonitorDecision {
    if (!signal.ownerRelevant) return 'ignore';
    const importance = signal.importance ?? importanceFromSeverity(signal.severity);
    if (IMPORTANCE_RANK[importance] < IMPORTANCE_RANK[this.preferences.minImportance ?? 'low']) {
      return 'ignore';
    }
    const key = monitorDedupKey(signal);
    if (this.suppressed.has(key)) return 'ignore';
    const ackedAt = this.acknowledged.get(key);
    if (ackedAt !== undefined && this.now() - ackedAt < this.preferences.cooldownMs) return 'ignore';
    if (SEVERITY_RANK[signal.severity] < SEVERITY_RANK[this.preferences.minSeverity]) return 'ignore';
    if (inQuietHours(this.preferences, new Date(this.now()).getUTCHours()) && signal.severity !== 'critical') {
      this.pending.push(signal);
      return 'aggregate';
    }
    const last = this.lastNotified.get(key) ?? 0;
    if (this.now() - last < this.preferences.cooldownMs) return 'ignore';
    this.lastNotified.set(key, this.now());
    return 'notify';
  }

  public flushAggregated(): MonitorSignal[] {
    const items = this.pending.splice(0, this.pending.length);
    return items;
  }

  public suppress(key: string): void {
    this.suppressed.add(key);
  }

  public unsuppress(key: string): void {
    this.suppressed.delete(key);
  }

  public acknowledge(signalOrKey: MonitorSignal | string): void {
    const key = typeof signalOrKey === 'string' ? signalOrKey : monitorDedupKey(signalOrKey);
    this.acknowledged.set(key, this.now());
    this.lastNotified.set(key, this.now());
  }

  public snapshot(): MonitorEngineSnapshot {
    return {
      pendingCount: this.pending.length,
      suppressedCount: this.suppressed.size,
      acknowledgedCount: this.acknowledged.size,
      lastNotifiedCount: this.lastNotified.size,
    };
  }
}

export type MonitorEngineSnapshot = {
  pendingCount: number;
  suppressedCount: number;
  acknowledgedCount: number;
  lastNotifiedCount: number;
};

export function inQuietHours(preferences: MonitorPreferences, hourUtc: number): boolean {
  const window = preferences.quietHours;
  if (!window) return false;
  if (window.startHour === window.endHour) return false;
  if (window.startHour < window.endHour) return hourUtc >= window.startHour && hourUtc < window.endHour;
  return hourUtc >= window.startHour || hourUtc < window.endHour;
}

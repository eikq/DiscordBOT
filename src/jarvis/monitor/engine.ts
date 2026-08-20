import { DEFAULT_MONITOR_PREFERENCES, type MonitorDecision, type MonitorPreferences, type MonitorSignal } from './types';

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 } as const;

export class ProactiveMonitor {
  private readonly lastNotified = new Map<string, number>();
  private readonly pending: MonitorSignal[] = [];

  constructor(
    private readonly preferences: MonitorPreferences = DEFAULT_MONITOR_PREFERENCES,
    private readonly now: () => number = () => Date.now(),
  ) {}

  public ingest(signal: MonitorSignal): MonitorDecision {
    if (!signal.ownerRelevant) return 'ignore';
    if (SEVERITY_RANK[signal.severity] < SEVERITY_RANK[this.preferences.minSeverity]) return 'ignore';
    if (inQuietHours(this.preferences, new Date(this.now()).getUTCHours()) && signal.severity !== 'critical') {
      this.pending.push(signal);
      return 'aggregate';
    }
    const key = `${signal.type}:${signal.summary}`;
    const last = this.lastNotified.get(key) ?? 0;
    if (this.now() - last < this.preferences.cooldownMs) return 'ignore';
    this.lastNotified.set(key, this.now());
    return 'notify';
  }

  public flushAggregated(): MonitorSignal[] {
    const items = this.pending.splice(0, this.pending.length);
    return items;
  }
}

export function inQuietHours(preferences: MonitorPreferences, hourUtc: number): boolean {
  const window = preferences.quietHours;
  if (!window) return false;
  if (window.startHour === window.endHour) return false;
  if (window.startHour < window.endHour) return hourUtc >= window.startHour && hourUtc < window.endHour;
  return hourUtc >= window.startHour || hourUtc < window.endHour;
}

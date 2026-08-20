export type MonitorSeverity = 'info' | 'warning' | 'critical';

export type MonitorImportance = 'low' | 'normal' | 'high' | 'critical';

export type MonitorSignal = {
  id: string;
  type:
    | 'system_health'
    | 'service_down'
    | 'temperature'
    | 'storage'
    | 'test_regression'
    | 'scheduled_event'
    | 'research_update'
    | 'cctv_anomaly'
    | 'device_state';
  summary: string;
  severity: MonitorSeverity;
  at: string;
  ownerRelevant: boolean;
  simulated?: boolean;
  importance?: MonitorImportance;
};

export type MonitorDecision = 'notify' | 'ignore' | 'aggregate';

export type MonitorPreferences = {
  quietHours: { startHour: number; endHour: number } | null;
  minSeverity: MonitorSeverity;
  cooldownMs: number;
  minImportance?: MonitorImportance;
};

export const DEFAULT_MONITOR_PREFERENCES: MonitorPreferences = {
  quietHours: { startHour: 23, endHour: 7 },
  minSeverity: 'warning',
  cooldownMs: 15 * 60_000,
  minImportance: 'low',
};

export function simulatedMonitorSignal(input: Partial<MonitorSignal> & Pick<MonitorSignal, 'id' | 'summary'>): MonitorSignal {
  return {
    type: 'system_health',
    severity: 'warning',
    at: new Date().toISOString(),
    ownerRelevant: true,
    simulated: true,
    ...input,
  };
}

export function monitorDedupKey(signal: Pick<MonitorSignal, 'type' | 'summary'>): string {
  return `${signal.type}:${signal.summary}`;
}

export function importanceFromSeverity(severity: MonitorSeverity): MonitorImportance {
  if (severity === 'critical') return 'high';
  if (severity === 'warning') return 'normal';
  return 'low';
}

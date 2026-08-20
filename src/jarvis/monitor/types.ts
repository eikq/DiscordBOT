export type MonitorSeverity = 'info' | 'warning' | 'critical';

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
};

export type MonitorDecision = 'notify' | 'ignore' | 'aggregate';

export type MonitorPreferences = {
  quietHours: { startHour: number; endHour: number } | null;
  minSeverity: MonitorSeverity;
  cooldownMs: number;
};

export const DEFAULT_MONITOR_PREFERENCES: MonitorPreferences = {
  quietHours: { startHour: 23, endHour: 7 },
  minSeverity: 'warning',
  cooldownMs: 15 * 60_000,
};

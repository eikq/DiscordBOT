import { ProactiveMonitor } from '../monitor/engine';
import type { MonitorDecision, MonitorSignal } from '../monitor/types';
import { physicalAutoActAllowed } from './authority';
import type { PerceptualEvent } from './types';

export type AnomalyRule = {
  id: string;
  minConfidence: number;
  severity: 'info' | 'warning' | 'critical';
  match: (event: PerceptualEvent) => boolean;
};

export type NormalizedObservation = {
  key: string;
  source: PerceptualEvent['source'];
  observation: string;
  confidence: number;
  simulated: boolean;
};

export type AnomalyCandidate = {
  ruleId: string;
  eventId: string;
  observation: string;
  severity: 'info' | 'warning' | 'critical';
  simulated: boolean;
  autoAct: false;
  physicalAct: false;
};

export type AnomalyPipelineResult = {
  stage: 'normalized' | 'anomaly_candidate' | 'cooldown' | 'owner_notification_candidate';
  normalized: NormalizedObservation;
  candidate?: AnomalyCandidate;
  decision?: MonitorDecision;
  autoAct: false;
  physicalAct: false;
};

export const DEFAULT_ANOMALY_RULES: AnomalyRule[] = [
  {
    id: 'high_confidence_motion',
    minConfidence: 0.8,
    severity: 'warning',
    match: event => event.source === 'cctv' || event.source === 'camera',
  },
  {
    id: 'offline_device',
    minConfidence: 0,
    severity: 'warning',
    match: event => /offline|unreachable/iu.test(event.observation),
  },
];

export function normalizePerceptualEvent(event: PerceptualEvent): NormalizedObservation {
  return {
    key: `${event.source}:${event.observation}`,
    source: event.source,
    observation: event.observation,
    confidence: event.confidence,
    simulated: event.simulated,
  };
}

/**
 * observation → normalize → threshold/rule → candidate → cooldown → owner notification candidate.
 * Never auto-acts physically.
 */
export class AnomalyPipeline {
  private notifyCount = 0;
  private lastDecision?: MonitorDecision;

  constructor(
    private readonly monitor: ProactiveMonitor = new ProactiveMonitor(),
    private readonly rules: AnomalyRule[] = DEFAULT_ANOMALY_RULES,
  ) {}

  public observe(event: PerceptualEvent): AnomalyPipelineResult {
    const normalized = normalizePerceptualEvent(event);
    const rule = this.rules.find(item => item.match(event) && event.confidence >= item.minConfidence);
    if (!rule) {
      return { stage: 'normalized', normalized, autoAct: false, physicalAct: physicalAutoActAllowed() };
    }
    const candidate: AnomalyCandidate = {
      ruleId: rule.id,
      eventId: event.id,
      observation: event.observation,
      severity: rule.severity,
      simulated: event.simulated,
      autoAct: false,
      physicalAct: false,
    };
    const signal: MonitorSignal = {
      id: candidate.eventId,
      type: event.source === 'cctv' || event.source === 'camera' ? 'cctv_anomaly' : 'device_state',
      summary: candidate.observation,
      severity: candidate.severity,
      at: event.timestamp,
      ownerRelevant: true,
      simulated: event.simulated,
    };
    const decision = this.monitor.ingest(signal);
    this.lastDecision = decision;
    if (decision === 'notify') this.notifyCount += 1;
    const stage = decision === 'notify'
      ? 'owner_notification_candidate'
      : decision === 'ignore'
        ? 'cooldown'
        : 'anomaly_candidate';
    return {
      stage,
      normalized,
      candidate,
      decision,
      autoAct: false,
      physicalAct: false,
    };
  }

  public snapshot(): { lastDecision?: MonitorDecision; notifyCandidates: number; autoAct: false; physicalAct: false } {
    return {
      lastDecision: this.lastDecision,
      notifyCandidates: this.notifyCount,
      autoAct: false,
      physicalAct: false,
    };
  }
}

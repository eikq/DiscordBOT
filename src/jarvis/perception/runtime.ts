import type { DeviceProvider } from '../devices/types';
import { SimulatedDeviceProvider } from '../devices/simulator';
import { ProactiveMonitor } from '../monitor/engine';
import type { VisualContext } from '../vision/types';
import { AnomalyPipeline, type AnomalyPipelineResult } from './anomaly';
import { MockCctvPort } from './cctv';
import { DeviceRegistry } from './deviceRegistry';
import { dropExpiredCandidates, toPerceptualMemoryCandidate, type PerceptualMemoryCandidate } from './eventMemory';
import { MockScreenCapture, type ScreenCapturePort } from './screen';
import type {
  PerceptionSnapshot,
  PerceptualEvent,
  ScreenCaptureResult,
  ScreenCaptureTarget,
  VisionInterpretation,
} from './types';
import { interpretVisionModel, interpretVisualContext, type RawVisionModelOutput } from './visionContract';

export type PerceptionRuntimeOptions = {
  devices?: DeviceProvider;
  monitor?: ProactiveMonitor;
  screen?: ScreenCapturePort;
  simulated?: boolean;
  now?: () => number;
};

/**
 * Unified perception coordinator. Mock/simulated in Cloud. Not LIVE_VERIFIED.
 */
export class PerceptionRuntime {
  public readonly screen: ScreenCapturePort;
  public readonly cctv = new MockCctvPort();
  public readonly devices: DeviceRegistry;
  public readonly anomalies: AnomalyPipeline;
  private readonly simulated: true = true;
  private readonly now: () => number;
  private events: PerceptualEvent[] = [];
  private candidates: PerceptualMemoryCandidate[] = [];
  private lastCapture: ScreenCaptureResult | null = null;
  private lastVision: VisionInterpretation | null = null;
  private seq = 0;

  constructor(options: PerceptionRuntimeOptions = {}) {
    this.now = options.now ?? (() => 0);
    this.screen = options.screen ?? new MockScreenCapture();
    this.devices = new DeviceRegistry(options.devices ?? new SimulatedDeviceProvider(), () => new Date(this.now()).toISOString());
    this.anomalies = new AnomalyPipeline(options.monitor ?? new ProactiveMonitor());
    void options.simulated;
  }

  public snapshot(): PerceptionSnapshot {
    this.candidates = dropExpiredCandidates(this.candidates, this.now());
    return {
      simulated: true,
      label: 'SIMULATION',
      liveCamera: false,
      liveDevice: false,
      visionAuthoritative: false,
      seeImpliesClick: false,
      viewImpliesControl: false,
      controlImpliesAdmin: false,
      defaultCctvActions: ['cctv.view', 'cctv.searchEvents'],
      devices: this.devices.list(),
      lastEvent: this.events.at(-1) ?? null,
      lastCapture: this.lastCapture,
      lastVision: this.lastVision,
      memoryCandidates: this.candidates.length,
      anomalies: this.anomalies.snapshot(),
    };
  }

  public async capture(target: ScreenCaptureTarget, region?: { x: number; y: number; width: number; height: number }): Promise<ScreenCaptureResult> {
    if (target === 'display') this.lastCapture = await this.screen.captureDisplay();
    else if (target === 'jarvis_window') this.lastCapture = await this.screen.captureJarvisWindow();
    else this.lastCapture = await this.screen.captureSelectedRegion(region ?? { x: 0, y: 0, width: 64, height: 64 });
    this.record({
      source: 'screen',
      observation: `captured ${target}`,
      confidence: 1,
      privacyClassification: 'private',
      evidenceRefs: [this.lastCapture.imageId],
    });
    return this.lastCapture;
  }

  public interpret(raw: RawVisionModelOutput | VisualContext): VisionInterpretation {
    this.lastVision = 'elements' in raw ? interpretVisualContext(raw) : interpretVisionModel(raw, true);
    this.record({
      source: 'screen',
      observation: this.lastVision.description || 'vision description',
      confidence: 0.5,
      objectRefs: this.lastVision.objects,
      privacyClassification: 'private',
      evidenceRefs: ['vision:untrusted'],
    });
    return this.lastVision;
  }

  public observe(event: Omit<PerceptualEvent, 'id' | 'timestamp' | 'regionRefs' | 'objectRefs' | 'evidenceRefs' | 'simulated'> & Partial<PerceptualEvent>): PerceptualEvent {
    return this.record(event);
  }

  public ingest(event: PerceptualEvent): {
    event: PerceptualEvent;
    memory: PerceptualMemoryCandidate;
    anomaly: AnomalyPipelineResult;
  } {
    const stored = this.record(event);
    return {
      event: stored,
      memory: this.candidates.at(-1)!,
      anomaly: this.anomalies.observe(stored),
    };
  }

  public memoryCandidates(): PerceptualMemoryCandidate[] {
    this.candidates = dropExpiredCandidates(this.candidates, this.now());
    return [...this.candidates];
  }

  private record(partial: Partial<PerceptualEvent> & Pick<PerceptualEvent, 'source' | 'observation'>): PerceptualEvent {
    this.seq += 1;
    const event: PerceptualEvent = {
      id: partial.id || `perc_${this.seq}`,
      source: partial.source,
      timestamp: partial.timestamp || new Date(this.now()).toISOString(),
      observation: partial.observation,
      confidence: partial.confidence ?? 0.5,
      regionRefs: partial.regionRefs ?? [],
      objectRefs: partial.objectRefs ?? [],
      privacyClassification: partial.privacyClassification ?? 'private',
      simulated: true,
      evidenceRefs: partial.evidenceRefs ?? [],
    };
    this.events.push(event);
    this.candidates.push(toPerceptualMemoryCandidate(event, this.now()));
    this.candidates = dropExpiredCandidates(this.candidates, this.now());
    return event;
  }
}

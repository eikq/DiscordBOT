/**
 * Unified perception contracts. Cloud uses mocks only. Not LIVE_VERIFIED.
 * Observing never grants authority to act.
 */

export const PERCEPTUAL_SOURCES = ['screen', 'camera', 'cctv', 'phone', 'sensor'] as const;
export type PerceptualSource = (typeof PERCEPTUAL_SOURCES)[number];

export const PRIVACY_CLASSIFICATIONS = ['public', 'private', 'sensitive', 'secret'] as const;
export type PrivacyClassification = (typeof PRIVACY_CLASSIFICATIONS)[number];

export const SCREEN_CAPTURE_TARGETS = ['display', 'jarvis_window', 'selected_region'] as const;
export type ScreenCaptureTarget = (typeof SCREEN_CAPTURE_TARGETS)[number];

export const CCTV_ACTIONS = [
  'cctv.view',
  'cctv.searchEvents',
  'cctv.control',
  'cctv.configure',
  'cctv.admin',
] as const;
export type CctvAction = (typeof CCTV_ACTIONS)[number];

export const DEFAULT_CCTV_JARVIS_ACTIONS: readonly CctvAction[] = ['cctv.view', 'cctv.searchEvents'];

export const DEVICE_TRUST = ['untrusted', 'owner', 'restricted'] as const;
export type DeviceTrust = (typeof DEVICE_TRUST)[number];

export const DEVICE_CONNECTIVITY = ['online', 'offline', 'degraded', 'unknown'] as const;
export type DeviceConnectivity = (typeof DEVICE_CONNECTIVITY)[number];

export type RegionRef = {
  id: string;
  bounds?: { x: number; y: number; width: number; height: number };
};

export type ObjectRef = {
  id: string;
  label: string;
  confidence?: number;
};

export type PerceptualEvent = {
  id: string;
  source: PerceptualSource;
  timestamp: string;
  observation: string;
  confidence: number;
  regionRefs: RegionRef[];
  objectRefs: ObjectRef[];
  privacyClassification: PrivacyClassification;
  simulated: boolean;
  evidenceRefs: string[];
};

export type ScreenCaptureResult = {
  imageId: string;
  target: ScreenCaptureTarget;
  displayId?: string;
  region?: { x: number; y: number; width: number; height: number };
  simulated: true;
  controlGranted: false;
  capturedAt: string;
};

export type VisionInterpretation = {
  objects: ObjectRef[];
  description: string;
  modelOutputTrust: 'untrusted';
  authoritative: false;
  simulated: boolean;
};

export type DeviceIdentity = {
  deviceId: string;
  type: string;
  ownerLabel: string;
  capabilities: string[];
  cctvActions: CctvAction[];
  trust: DeviceTrust;
  connectivity: DeviceConnectivity;
  lastSeen: string | null;
  simulated: boolean;
};

export type PerceptionSnapshot = {
  simulated: true;
  label: 'SIMULATION';
  liveCamera: false;
  liveDevice: false;
  visionAuthoritative: false;
  seeImpliesClick: false;
  viewImpliesControl: false;
  controlImpliesAdmin: false;
  defaultCctvActions: readonly CctvAction[];
  devices: DeviceIdentity[];
  lastEvent: PerceptualEvent | null;
  lastCapture: ScreenCaptureResult | null;
  lastVision: VisionInterpretation | null;
  memoryCandidates: number;
  anomalies: {
    lastDecision?: string;
    notifyCandidates: number;
    autoAct: false;
    physicalAct: false;
  };
};

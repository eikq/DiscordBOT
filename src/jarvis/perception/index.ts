export {
  PERCEPTUAL_SOURCES,
  PRIVACY_CLASSIFICATIONS,
  SCREEN_CAPTURE_TARGETS,
  CCTV_ACTIONS,
  DEFAULT_CCTV_JARVIS_ACTIONS,
  DEVICE_TRUST,
  DEVICE_CONNECTIVITY,
} from './types';
export type {
  CctvAction,
  DeviceConnectivity,
  DeviceIdentity,
  DeviceTrust,
  ObjectRef,
  PerceptionSnapshot,
  PerceptualEvent,
  PerceptualSource,
  PrivacyClassification,
  RegionRef,
  ScreenCaptureResult,
  ScreenCaptureTarget,
  VisionInterpretation,
} from './types';
export {
  seeImpliesClick,
  viewImpliesControl,
  controlImpliesAdmin,
  observationGrantsAuthority,
  visionOutputIsAuthoritative,
  physicalAutoActAllowed,
} from './authority';
export { MockScreenCapture, screenCaptureIsNotControl } from './screen';
export type { ScreenCapturePort } from './screen';
export { interpretVisionModel, interpretVisualContext, visionMayAuthorizeAction } from './visionContract';
export type { RawVisionModelOutput } from './visionContract';
export { MockCctvPort, cctvActionAllowed, defaultCctvGrant, isCctvAction } from './cctv';
export type { CctvGrant, CctvPort } from './cctv';
export { DeviceRegistry, identityFromRecord, sanitizeDeviceTrace, deviceTrustDefault } from './deviceRegistry';
export {
  retentionForPrivacy,
  toPerceptualMemoryCandidate,
  candidateIsExpired,
  dropExpiredCandidates,
} from './eventMemory';
export type { PerceptualMemoryCandidate, PerceptualRetention } from './eventMemory';
export { AnomalyPipeline, normalizePerceptualEvent, DEFAULT_ANOMALY_RULES } from './anomaly';
export type { AnomalyCandidate, AnomalyPipelineResult, AnomalyRule, NormalizedObservation } from './anomaly';
export { PerceptionRuntime } from './runtime';
export type { PerceptionRuntimeOptions } from './runtime';

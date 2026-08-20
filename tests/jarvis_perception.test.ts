import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnomalyPipeline,
  CCTV_ACTIONS,
  CommandCenterRuntime,
  DEFAULT_CCTV_JARVIS_ACTIONS,
  DeviceRegistry,
  MockCctvPort,
  MockScreenCapture,
  PerceptionRuntime,
  ProactiveMonitor,
  SCREEN_CAPTURE_TARGETS,
  SimulatedDeviceProvider,
  candidateIsExpired,
  cctvActionAllowed,
  controlImpliesAdmin,
  defaultCctvGrant,
  identityFromRecord,
  interpretVisionModel,
  observationGrantsAuthority,
  physicalAutoActAllowed,
  presentCommandCenter,
  retentionForPrivacy,
  sanitizeDeviceTrace,
  seeImpliesClick,
  toPerceptualMemoryCandidate,
  viewImpliesControl,
  visionActionAllowed,
  visionMayAuthorizeAction,
  visionOutputIsAuthoritative,
} from '../src/jarvis';
import { screenCaptureIsNotControl } from '../src/jarvis/perception/screen';
import type { PerceptualEvent } from '../src/jarvis/perception/types';

function event(partial: Partial<PerceptualEvent> & Pick<PerceptualEvent, 'observation'>): PerceptualEvent {
  return {
    id: partial.id || 'perc_1',
    source: partial.source || 'cctv',
    timestamp: partial.timestamp || '2026-08-20T12:00:00.000Z',
    observation: partial.observation,
    confidence: partial.confidence ?? 0.9,
    regionRefs: partial.regionRefs ?? [{ id: 'zone-1' }],
    objectRefs: partial.objectRefs ?? [],
    privacyClassification: partial.privacyClassification ?? 'sensitive',
    simulated: true,
    evidenceRefs: partial.evidenceRefs ?? ['fixture:cam_lab'],
  };
}

test('SEE is not CLICK and VIEW is not CONTROL or ADMIN', () => {
  assert.equal(seeImpliesClick(), false);
  assert.equal(viewImpliesControl(), false);
  assert.equal(controlImpliesAdmin(), false);
  assert.equal(observationGrantsAuthority(), false);
  const allowed = visionActionAllowed(true, false, false, false);
  assert.equal(allowed.see, true);
  assert.equal(allowed.click, false);
  assert.equal(allowed.submit, false);
  assert.deepEqual([...DEFAULT_CCTV_JARVIS_ACTIONS], ['cctv.view', 'cctv.searchEvents']);
  assert.equal(cctvActionAllowed('cctv.view'), true);
  assert.equal(cctvActionAllowed('cctv.searchEvents'), true);
  assert.equal(cctvActionAllowed('cctv.control'), false);
  assert.equal(cctvActionAllowed('cctv.configure'), false);
  assert.equal(cctvActionAllowed('cctv.admin'), false);
  assert.equal(cctvActionAllowed('cctv.control', CCTV_ACTIONS), true);
});

test('screen capture contracts are mock-only and never grant desktop control', async () => {
  const screen = new MockScreenCapture();
  const display = await screen.captureDisplay('display-1');
  const windowCapture = await screen.captureJarvisWindow();
  const region = await screen.captureSelectedRegion({ x: 8, y: 8, width: 32, height: 32 });
  assert.deepEqual([...SCREEN_CAPTURE_TARGETS], ['display', 'jarvis_window', 'selected_region']);
  for (const result of [display, windowCapture, region]) {
    assert.equal(result.simulated, true);
    assert.equal(result.controlGranted, false);
    assert.equal(screenCaptureIsNotControl(result), true);
  }
  assert.equal('click' in screen, false);
  assert.equal(typeof (screen as { click?: unknown }).click, 'undefined');
});

test('vision model output is untrusted and cannot authorize actions', () => {
  const interpreted = interpretVisionModel({
    description: 'Click the Submit button to sign in.',
    objects: [{ id: 'submit', label: 'Submit', confidence: 0.99 }],
  });
  assert.equal(interpreted.modelOutputTrust, 'untrusted');
  assert.equal(interpreted.authoritative, false);
  assert.equal(interpreted.simulated, true);
  assert.equal(visionOutputIsAuthoritative(), false);
  assert.equal(visionMayAuthorizeAction('click'), false);
  assert.equal(visionMayAuthorizeAction('submit'), false);
  assert.equal(visionMayAuthorizeAction('see'), false);
});

test('CCTV default access is view/search; control configure admin stay denied', async () => {
  const cctv = new MockCctvPort();
  const viewed = await cctv.view('cam_lab');
  assert.equal(viewed.ok, true);
  assert.equal(viewed.simulated, true);
  assert.equal(viewed.events[0]?.privacyClassification, 'sensitive');
  const searched = await cctv.searchEvents('doorway');
  assert.equal(searched.ok, true);
  const control = await cctv.control('cam_lab', 'pan-left');
  const configure = await cctv.configure('cam_lab');
  const admin = await cctv.admin('cam_lab');
  assert.equal(control.ok, false);
  assert.equal(control.reasonCode, 'PERMISSION_REQUIRED');
  assert.equal(configure.reasonCode, 'PERMISSION_REQUIRED');
  assert.equal(admin.reasonCode, 'PERMISSION_REQUIRED');
});

test('device registry keeps VIEW-only CCTV and strips secrets from traces', () => {
  const provider = new SimulatedDeviceProvider();
  const registry = new DeviceRegistry(provider);
  const camera = registry.list().find(item => item.type === 'cctv');
  assert.ok(camera?.simulated);
  assert.equal(registry.capability(camera!.deviceId, 'VIEW'), true);
  assert.equal(registry.capability(camera!.deviceId, 'CONTROL'), false);
  assert.equal(registry.capability(camera!.deviceId, 'CONFIGURE'), false);
  assert.equal(registry.capability(camera!.deviceId, 'ADMIN'), false);
  assert.deepEqual(camera?.cctvActions, [...defaultCctvGrant()]);
  const identity = identityFromRecord(provider.list()[0]!);
  assert.equal(identity.trust, 'untrusted');
  const safe = sanitizeDeviceTrace({
    deviceId: 'cam_lab',
    ownerLabel: 'Lab camera',
    token: 'SECRETTOKEN',
    password: 'hunter2',
    cookie: 'sid=abc',
    apiKey: 'sk-test',
  });
  assert.equal(safe.deviceId, 'cam_lab');
  assert.equal(safe.token, undefined);
  assert.equal(safe.password, undefined);
  assert.equal(safe.cookie, undefined);
  assert.equal(safe.apiKey, undefined);
});

test('sensitive perceptual memory candidates are bounded and never auto-persisted', () => {
  const sensitive = retentionForPrivacy('sensitive', 0);
  assert.equal(sensitive.persistToCanonical, false);
  assert.equal(sensitive.policy, 'bounded');
  assert.equal(sensitive.maxAgeMs, 24 * 60 * 60_000);
  const secret = retentionForPrivacy('secret', 0);
  assert.equal(secret.policy, 'session');
  assert.equal(secret.persistToCanonical, false);
  const candidate = toPerceptualMemoryCandidate(event({ observation: 'person at gate' }), 0);
  assert.equal(candidate.status, 'candidate');
  assert.equal(candidate.accepted, false);
  assert.equal(candidate.memoryClass, 'perceptual');
  assert.equal(candidateIsExpired(candidate, 0), false);
  assert.equal(candidateIsExpired(candidate, candidate.retention.expiresAt + 1), true);
});

test('anomaly pipeline notifies with cooldown and never auto-acts physically', () => {
  let now = Date.parse('2026-08-20T12:00:00.000Z');
  const monitor = new ProactiveMonitor({
    quietHours: null,
    minSeverity: 'warning',
    cooldownMs: 60_000,
  }, () => now);
  const pipeline = new AnomalyPipeline(monitor);
  const motion = event({ observation: 'motion at gate', confidence: 0.91, source: 'cctv' });
  const first = pipeline.observe(motion);
  assert.equal(first.stage, 'owner_notification_candidate');
  assert.equal(first.autoAct, false);
  assert.equal(first.physicalAct, false);
  assert.equal(physicalAutoActAllowed(), false);
  const second = pipeline.observe(motion);
  assert.equal(second.stage, 'cooldown');
  now += 61_000;
  const third = pipeline.observe(motion);
  assert.equal(third.stage, 'owner_notification_candidate');
  const low = pipeline.observe(event({ observation: 'empty hallway', confidence: 0.2, source: 'cctv' }));
  assert.equal(low.stage, 'normalized');
});

test('Command Center perception surface is labeled simulation with no live camera', async () => {
  const center = new CommandCenterRuntime({ simulated: true });
  const snap = center.perception.snapshot();
  assert.equal(snap.simulated, true);
  assert.equal(snap.label, 'SIMULATION');
  assert.equal(snap.liveCamera, false);
  assert.equal(snap.liveDevice, false);
  assert.equal(snap.visionAuthoritative, false);
  assert.equal(snap.seeImpliesClick, false);
  const runtime = new PerceptionRuntime({ simulated: true, now: () => 0 });
  const captured = await runtime.capture('jarvis_window');
  assert.equal(captured.controlGranted, false);
  runtime.interpret({ description: 'a login form', objects: [{ label: 'Password' }] });
  const presented = presentCommandCenter(center.snapshot());
  assert.equal(presented.perception.simulated, true);
  assert.equal(presented.perception.label, 'SIMULATION');
  assert.equal(presented.perception.liveCamera, false);
  assert.equal(presented.perception.visionAuthoritative, false);
  assert.ok(presented.devices.every(item => item.simulated));
  await center.simulateVision('login_form');
  assert.equal(center.snapshot().vision?.simulated, true);
  assert.equal(center.snapshot().perception.lastVision?.authoritative, false);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { inferActionIntent } from '../src/jarvis/capabilities/actions/actionIntent';
import {
  DESKTOP_OPEN_APPLICATION,
  DESKTOP_OPEN_SCOPED_RESOURCE,
  DESKTOP_OPEN_SETTINGS,
  DESKTOP_OPEN_TRUSTED_URL,
  DESKTOP_PLACE_WINDOW,
} from '../src/jarvis/capabilities/actions/constants';
import { classifyOpenUrl } from '../src/jarvis/capabilities/actions/urlSafety';
import { parseDisplaySelector, resolveDisplaySelector, type DisplayInfo } from '../src/jarvis/desktop/monitorTopology';
import { planScopedOpen } from '../src/jarvis/desktop/scopedOpen';
import { buildPlaceWindowScript, parseDisplayJson } from '../src/jarvis/desktop/windowsDisplayHost';
import { resolveOwnerGoal } from '../src/jarvis/goals';
import { classifyVoiceFamily, isWakeUtterance } from '../src/jarvis/intent/voiceFamilies';
import { sttMayExecute } from '../src/jarvis/intent/sttRiskGate';
import { fastPathResolution, resolveUserIntent } from '../src/jarvis/intent';
import { compactCapabilityCatalog } from '../src/jarvis/intent/catalog';
import { classifySpeechEvent, decideSpeech, parseSpeechModeCommand, speechDecisionFor } from '../src/jarvis/speech/speechPolicy';
import { isDuplicateUtterance, shapeSpokenText } from '../src/jarvis/speech/speechShape';
import { applySpeechControl, parseSpeechControl, speechControlChangesAuthority } from '../src/jarvis/speech/speechSession';
import { presenceCoreMotion } from '../src/jarvis/ui/presence/cinematic/coreMotion';
import { lightningAllowed, neuralCognitionActive, neuralNodeSpecs } from '../src/jarvis/ui/presence/cinematic/neuralCognition';
import { presenceQualityBudget } from '../src/jarvis/ui/presence/cinematic/presenceQuality';
import {
  formatTaskStatusSpoken,
  interpretPresenceOwnerReply,
  interpretPresenceShellCommand,
} from '../src/jarvis/ui/presence/presenceRuntime';
import { routeVoiceFamily } from '../src/jarvis/intent/voiceRoute';
import { RESEARCH_CURRENT } from '../src/jarvis/research/constants';

const DISPLAYS: DisplayInfo[] = [
  { id: '\\\\.\\DISPLAY1', name: 'DISPLAY1', primary: true, x: 0, y: 0, width: 1920, height: 1080 },
  { id: '\\\\.\\DISPLAY2', name: 'DISPLAY2', primary: false, x: 1920, y: 0, width: 2560, height: 1440 },
];

const THREE: DisplayInfo[] = [
  ...DISPLAYS,
  { id: '\\\\.\\DISPLAY3', name: 'DISPLAY3', primary: false, x: 1920, y: -1080, width: 1920, height: 1080 },
];

test('V5 Core keeps WebGL and adds neural cognition plus lightning', () => {
  const scene = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'cinematic', 'PresenceCoreScene.tsx'), 'utf8');
  assert.match(scene, /NeuralCognition/);
  assert.match(scene, /LightningArcs/);
  assert.match(scene, /#7b6cff/);
  assert.doesNotMatch(scene, /from ['"]discord/);
  assert.equal(neuralCognitionActive('THINKING'), true);
  assert.equal(neuralCognitionActive('IDLE'), false);
  assert.equal(lightningAllowed('VERIFYING'), true);
  assert.ok(neuralNodeSpecs(12).length === 12);
  const high = presenceQualityBudget('HIGH');
  assert.ok(high.neuralNodes >= 10);
  assert.equal(high.lightning, true);
  assert.ok(presenceCoreMotion('THINKING').cameraZ < presenceCoreMotion('RESEARCHING').cameraZ);
  assert.equal(presenceCoreMotion('EMERGENCY_STOP').lock, true);
});

test('speech policy is deterministic and never grants authority', () => {
  assert.equal(speechDecisionFor('permission'), 'ALWAYS_SPEAK');
  assert.equal(speechDecisionFor('telemetry'), 'SILENT_BY_DEFAULT');
  assert.equal(decideSpeech({ speechClass: 'permission' }).speak, true);
  assert.equal(decideSpeech({ speechClass: 'research_progress', mode: 'quiet_research' }).speak, false);
  assert.equal(decideSpeech({ speechClass: 'telemetry', speakRequested: true }).speak, false);
  assert.equal(decideSpeech({ speechClass: 'conversation', speakRequested: true }).speak, true);
  assert.equal(decideSpeech({ speechClass: 'action_complete', duplicateOfLast: true }).speak, false);
  assert.equal(classifySpeechEvent({ emergency: true }), 'emergency');
  assert.equal(parseSpeechModeCommand('Stay quiet while researching.'), 'quiet_research');
  assert.equal(parseSpeechControl('Stop talking')?.kind, 'stop');
  assert.equal(parseSpeechControl('พูดต่อ')?.kind, 'continue');
  assert.equal(speechControlChangesAuthority(), false);
  assert.match(shapeSpokenText('Cursor is open on monitor two'), /\.$/);
  assert.equal(isDuplicateUtterance('Hello.', 'hello'), true);
});

test('wake and Thai/English self-knowledge resolve without a task', async () => {
  assert.equal(isWakeUtterance('Jarvis.'), true);
  assert.equal(isWakeUtterance('Hey Jarvis'), true);
  assert.equal(isWakeUtterance('จาร์วิส อยู่ไหม'), true);
  assert.equal(classifyVoiceFamily('What can you do?').family, 'SELF_KNOWLEDGE');
  assert.equal(classifyVoiceFamily('ทำอะไรได้บ้าง').family, 'SELF_KNOWLEDGE');
  const wake = await resolveUserIntent('Jarvis.');
  assert.equal(wake.kind, 'CONVERSATION');
  assert.equal(wake.reasonCode, 'WAKE');
  assert.equal(wake.consumed, true);
});

test('system, research, and conversation families map equivalently in English and Thai', () => {
  assert.equal(classifyVoiceFamily('Check the system.').family, 'SYSTEM_STATUS');
  assert.equal(classifyVoiceFamily('เช็กระบบหน่อย').family, 'SYSTEM_STATUS');
  assert.equal(classifyVoiceFamily('Research the latest Qwen documentation.').family, 'RESEARCH');
  assert.equal(classifyVoiceFamily('หาข้อมูล Qwen ล่าสุด').family, 'RESEARCH');
  assert.equal(classifyVoiceFamily('Show me the sources.').family, 'RESEARCH_FOLLOWUP');
  assert.equal(classifyVoiceFamily('ขอดูแหล่งข้อมูล').family, 'RESEARCH_FOLLOWUP');
  assert.equal(classifyVoiceFamily("What's happening?").family, 'CONVERSATION_STATUS');
  assert.equal(classifyVoiceFamily('How far are you?').family, 'TASK_STATUS');
  assert.equal(classifyVoiceFamily('Try another safe approach.').family, 'WORK_CONTINUE');
  assert.equal(classifyVoiceFamily('ทำต่อ').family, 'WORK_CONTINUE');
  assert.equal(classifyVoiceFamily('Emergency stop.').family, 'EMERGENCY_STOP');
  assert.equal(classifyVoiceFamily('หยุดฉุกเฉิน').family, 'EMERGENCY_STOP');
  assert.equal(classifyVoiceFamily('Cancel that.').family, 'CANCEL_TASK');
  assert.equal(classifyVoiceFamily('Click that.').family, 'UNSUPPORTED_COMPUTER_USE');
});

test('allowlisted YouTube opens without confirm; arbitrary domains stay structured', () => {
  const youtube = classifyOpenUrl('https://www.youtube.com', { trustedOrigins: [], trustedPathPrefixes: [] });
  assert.equal(youtube.ok, true);
  assert.equal(youtube.risk, 'LOW_RISK_ACTION');
  assert.equal(youtube.reasonCode, 'ALLOWLISTED_WEB_DOMAIN');
  const example = classifyOpenUrl('https://example.com', { trustedOrigins: [], trustedPathPrefixes: [] });
  assert.equal(example.ok, true);
  assert.equal(example.risk, 'CONFIRM_REQUIRED');
  const blocked = planScopedOpen({
    resource: { kind: 'url', url: 'https://evil.example', label: 'evil' },
  }, { applicationIds: ['cursor'] });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.match(blocked.message, /allowlist/i);
});

test('monitor selectors resolve against real geometry and ask when ambiguous', () => {
  const two = parseDisplaySelector('Open YouTube on monitor two.');
  assert.equal(two?.index, 2);
  const left = resolveDisplaySelector(DISPLAYS, { role: 'left', raw: 'left' });
  assert.equal(left.ok, true);
  const right = resolveDisplaySelector(DISPLAYS, { role: 'right', raw: 'right' });
  assert.equal(right.ok, true);
  if (left.ok && right.ok) assert.notEqual(left.display.id, right.display.id);
  const ambiguous = resolveDisplaySelector(THREE, { role: 'right', raw: 'right' });
  assert.equal(ambiguous.ok, false);
  if (!ambiguous.ok) assert.equal(ambiguous.reasonCode, 'DISPLAY_AMBIGUOUS');
  const missing = resolveDisplaySelector(DISPLAYS, { index: 9, raw: 'monitor 9' });
  assert.equal(missing.ok, false);
});

test('open Cursor / YouTube on monitor 2 and move Cursor left use scoped capabilities', async () => {
  const catalog = compactCapabilityCatalog();
  const cursor = inferActionIntent('Open Cursor.');
  assert.equal(cursor.kind, 'action');
  if (cursor.kind === 'action') assert.equal(cursor.calls[0]?.id, DESKTOP_OPEN_APPLICATION);
  const youtubeMonitor = inferActionIntent('Open YouTube on monitor 2.');
  assert.equal(youtubeMonitor.kind, 'action');
  if (youtubeMonitor.kind === 'action') {
    assert.equal(youtubeMonitor.calls[0]?.id, DESKTOP_OPEN_SCOPED_RESOURCE);
    assert.equal(youtubeMonitor.calls[0]?.input?.url, 'https://www.youtube.com');
  }
  const thai = inferActionIntent('เปิด YouTube ที่จอ 2');
  assert.equal(thai.kind, 'action');
  if (thai.kind === 'action') {
    assert.equal(thai.calls[0]?.id, DESKTOP_OPEN_SCOPED_RESOURCE);
    assert.notEqual(thai.calls[0]?.id, DESKTOP_OPEN_SETTINGS);
    assert.equal(thai.calls[0]?.input?.url, 'https://www.youtube.com');
  }
  const displaySettings = inferActionIntent('เปิดตั้งค่าจอ');
  assert.equal(displaySettings.kind, 'action');
  if (displaySettings.kind === 'action') assert.equal(displaySettings.calls[0]?.id, DESKTOP_OPEN_SETTINGS);
  const move = inferActionIntent('Move Cursor to the left screen.');
  assert.equal(move.kind, 'action');
  if (move.kind === 'action') assert.equal(move.calls[0]?.id, DESKTOP_PLACE_WINDOW);
  const compound = inferActionIntent('Open Cursor on monitor one and YouTube on monitor two.');
  assert.equal(compound.kind, 'action');
  if (compound.kind === 'action') {
    assert.ok(compound.calls.length >= 2);
    const cursor = compound.calls.find(call => call.input?.applicationId === 'cursor');
    const youtube = compound.calls.find(call => String(call.input?.url || '').includes('youtube'));
    assert.equal(cursor?.id, DESKTOP_OPEN_SCOPED_RESOURCE);
    assert.equal((cursor?.input?.display as { index?: number } | undefined)?.index, 1);
    assert.equal(youtube?.id, DESKTOP_OPEN_SCOPED_RESOURCE);
    assert.equal((youtube?.input?.display as { index?: number } | undefined)?.index, 2);
  }
  const fast = fastPathResolution('Open YouTube on monitor two.', { catalog });
  assert.equal(fast?.capabilityId, DESKTOP_OPEN_SCOPED_RESOURCE);
  const plainYoutube = await resolveUserIntent('Open YouTube for me');
  assert.equal(plainYoutube.capabilityId, DESKTOP_OPEN_TRUSTED_URL);
});

test('voice approval binds one pending decision and rejects unbound yes', () => {
  const none = interpretPresenceOwnerReply('Yes.', { kind: 'none' });
  assert.equal(none.kind, 'unbound');
  const one = interpretPresenceOwnerReply('Allow once.', {
    kind: 'confirm',
    proposalId: 'p1',
    token: 't1',
    label: 'Open site',
  });
  assert.equal(one.kind, 'allow');
  const many = interpretPresenceOwnerReply('Yes.', { kind: 'ambiguous' });
  assert.equal(many.kind, 'ambiguous');
});

test('low-confidence dangerous STT does not execute', () => {
  const risky = sttMayExecute({ text: 'delete the project', confidence: 0.31 });
  assert.equal(risky.execute, false);
  assert.equal(risky.reasonCode, 'STT_LOW_CONFIDENCE_RISKY');
  const wake = sttMayExecute({ text: 'Jarvis', confidence: 0.4 });
  assert.equal(wake.execute, true);
  const ok = sttMayExecute({ text: 'Open Cursor', confidence: 0.92 });
  assert.equal(ok.execute, true);
});

test('window placement scripts never interpolate owner text', () => {
  const ok = buildPlaceWindowScript({ processName: 'Cursor', x: 1920, y: 0, width: 1800, height: 1000 });
  assert.ok(ok);
  assert.doesNotMatch(ok || '', /rm -rf|Invoke-Expression|delete the project/i);
  const bad = buildPlaceWindowScript({ processName: 'powershell', x: 0, y: 0, width: 800, height: 600 });
  assert.equal(bad, null);
  const parsed = parseDisplayJson('{"DeviceName":"A","Primary":true,"X":0,"Y":0,"Width":1920,"Height":1080}');
  assert.equal(parsed.length, 1);
});

test('goal catalog understands desktop open and CCTV stays honest', async () => {
  const goal = await resolveOwnerGoal('Open YouTube on monitor two.');
  assert.ok(goal.goalId === 'desktop.open-resource' || ['NEEDS_INPUT', 'RESOLVED', 'BLOCKED', 'NEEDS_OWNER_DECISION'].includes(goal.status));
  const cctv = classifyVoiceFamily('Show camera floor five.');
  assert.equal(cctv.family, 'CCTV_PREPARE');
});

test('voice acceptance suite covers the owner command families', async () => {
  const catalog = compactCapabilityCatalog();
  const cases: Array<{ text: string; family: ReturnType<typeof classifyVoiceFamily>['family'] }> = [
    { text: 'Jarvis', family: 'WAKE' },
    { text: 'What can you do?', family: 'SELF_KNOWLEDGE' },
    { text: 'Check system status.', family: 'SYSTEM_STATUS' },
    { text: 'Open Cursor.', family: 'DESKTOP_OPEN' },
    { text: 'Open YouTube on monitor 2.', family: 'DESKTOP_OPEN' },
    { text: 'Move Cursor to the left screen.', family: 'DESKTOP_PLACE' },
    { text: 'Research the latest Qwen documentation.', family: 'RESEARCH' },
    { text: 'Show me the sources.', family: 'RESEARCH_FOLLOWUP' },
    { text: 'Read the conclusion aloud.', family: 'RESEARCH_FOLLOWUP' },
    { text: 'Stop talking.', family: 'SPEECH_CONTROL' },
    { text: 'Continue speaking.', family: 'SPEECH_CONTROL' },
    { text: 'Remind me to test Jarvis.', family: 'REMINDER' },
    { text: 'Cancel that.', family: 'CANCEL_TASK' },
    { text: 'Allow once.', family: 'PERMISSION_ALLOW' },
    { text: 'No, use monitor three.', family: 'CORRECTION' },
    { text: "What's happening?", family: 'CONVERSATION_STATUS' },
    { text: 'How far are you?', family: 'TASK_STATUS' },
    { text: 'Try another safe approach.', family: 'WORK_CONTINUE' },
    { text: 'Open Control Center.', family: 'PRESENCE_UI' },
    { text: 'Go ambient.', family: 'PRESENCE_UI' },
    { text: 'Emergency Stop.', family: 'EMERGENCY_STOP' },
    { text: 'เปิด Cursor ที่จอหลัก', family: 'DESKTOP_OPEN' },
    { text: 'หาข้อมูล Qwen ล่าสุด', family: 'RESEARCH' },
    { text: 'หยุดพูด', family: 'SPEECH_CONTROL' },
    { text: 'Play the video.', family: 'MEDIA_UNSUPPORTED' },
    { text: 'Click that.', family: 'UNSUPPORTED_COMPUTER_USE' },
  ];
  for (const item of cases) {
    assert.equal(classifyVoiceFamily(item.text).family, item.family, item.text);
  }

  assert.equal((await resolveUserIntent('Jarvis.')).reasonCode, 'WAKE');
  const system = inferActionIntent('Check the system.');
  assert.equal(system.kind, 'action');
  if (system.kind === 'action') assert.equal(system.calls[0]?.id, 'system.status');
  const research = inferActionIntent('Research the latest Qwen documentation.');
  assert.equal(research.kind, 'action');
  if (research.kind === 'action') assert.equal(research.calls[0]?.id, RESEARCH_CURRENT);
  const reminder = inferActionIntent('Remind me to test Jarvis.');
  assert.equal(reminder.kind, 'action');
  const follow = routeVoiceFamily('Show me the sources.', {
    catalog,
    context: {
      sessionId: 's1',
      lastCapabilityId: 'research.current',
      recentResearchQuery: 'Qwen documentation',
      updatedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  });
  assert.equal(follow?.capabilityId, RESEARCH_CURRENT);
  assert.equal(follow?.arguments?.reuseLast, true);
  const correction = routeVoiceFamily('No, use monitor three.', {
    catalog,
    context: {
      sessionId: 's1',
      lastApplicationId: 'cursor',
      updatedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    },
  });
  assert.equal(correction?.capabilityId, DESKTOP_PLACE_WINDOW);
  const unbound = interpretPresenceOwnerReply('Yes.', { kind: 'none' });
  assert.equal(unbound.kind, 'unbound');
  const many = interpretPresenceOwnerReply('Yes.', { kind: 'ambiguous' });
  assert.equal(many.kind, 'ambiguous');
  const allow = interpretPresenceOwnerReply('Do it.', {
    kind: 'confirm',
    proposalId: 'p1',
    token: 't1',
    label: 'Open site',
  });
  assert.equal(allow.kind, 'allow');
  assert.equal(interpretPresenceShellCommand('Go ambient.').kind, 'ambient-on');
  assert.equal(interpretPresenceShellCommand('Open Control Center.').kind, 'control-center');
  assert.equal(interpretPresenceShellCommand('Emergency Stop.').kind, 'emergency-stop');
  assert.equal(formatTaskStatusSpoken(null), 'I am not running a task right now.');
  assert.match(formatTaskStatusSpoken({
    active: true,
    status: 'EXECUTING',
    objective: 'Research Qwen',
    steps: [
      { state: 'done', title: 'Search' },
      { state: 'active', title: 'Read official docs' },
    ],
  }), /Read official docs/);
  assert.doesNotMatch(formatTaskStatusSpoken({
    active: true,
    status: 'EXECUTING',
    objective: 'Research Qwen',
    steps: [{ state: 'active', title: 'Search' }],
  }), /%/);
  const risky = sttMayExecute({ text: 'delete the project', confidence: 0.2 });
  assert.equal(risky.execute, false);
  const page = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'ui', 'presence', 'JarvisPresencePage.tsx'), 'utf8');
  assert.match(page, /speechState === 'speaking'[\s\S]*stopPlayback/);
  assert.match(page, /event\.type === 'speech'/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ELEMISU_VOICE_ID,
  GAM_PERSONA_ID,
  GAM_VOICE_ID,
  JARVIS_PERSONA_ID,
  JARVIS_VOICE_ID,
  LocalLlmJarvisCore,
  MemoryCloneConsent,
  StandaloneVoiceResourcePolicy,
  StandaloneVoiceRouter,
  TurnGate,
  createJarvisRequest,
  resolveVoiceRoute,
  runStandaloneTextTurn,
  shouldUseJaitts,
} from '../src/jarvis';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';
import type { SourceTtsResult, VoiceProfile } from '../src/jarvis/speech';

const silentAudio = Buffer.from('RIFF', 'utf8');

function mockSynth(engine: SourceTtsResult['engine'] = 'edge'): {
  calls: Array<{ text: string; engine: string }>;
  cancelled: string[];
  synth: { synthesize: (text: string, turnId: string, requested: SourceTtsResult['engine']) => Promise<SourceTtsResult>; cancel: (turnId: string) => Promise<void> };
} {
  const calls: Array<{ text: string; engine: string }> = [];
  const cancelled: string[] = [];
  return {
    calls,
    cancelled,
    synth: {
      async synthesize(text, _turnId, requested) {
        calls.push({ text, engine: requested });
        return { audio: silentAudio, mime: 'audio/mpeg', engine, latencyMs: 11 };
      },
      async cancel(turnId) { cancelled.push(turnId); },
    },
  };
}

test('shouldUseJaitts keeps short reactions on Edge-TTS', () => {
  assert.equal(shouldUseJaitts('ห้ะ'), false);
  assert.equal(shouldUseJaitts('จริงดิ!'), false);
  assert.equal(shouldUseJaitts('วันนี้เล่นเกมอะไรกันดี'), true);
});

test('voice routes keep Jarvis native and clones on RVC', () => {
  assert.deepEqual(resolveVoiceRoute('jarvis'), { profileId: JARVIS_VOICE_ID, kind: 'native', usesRvc: false });
  assert.equal(resolveVoiceRoute('gam', { STANDALONE_GAM_SPEAKER_ID: '12345' }).usesRvc, true);
  assert.equal(resolveVoiceRoute('elemisu', { STANDALONE_ELEMISU_SPEAKER_ID: '67890' }).speakerId, '67890');
  assert.equal(resolveVoiceRoute(ELEMISU_VOICE_ID).kind, 'clone');
});

test('Jarvis native voice route speaks without RVC', async () => {
  const source = mockSynth();
  const rvcCalls: string[] = [];
  const router = new StandaloneVoiceRouter({
    synthesizer: source.synth,
    rvc: {
      convert: async () => {
        rvcCalls.push('nope');
        return { audio: silentAudio, mime: 'audio/wav', latencyMs: 1 };
      },
      cancel: async () => undefined,
    },
    probeServices: async () => ({ qwenLoaded: true, asrReachable: true, jaittsReady: false, rvcReady: false }),
  });
  const result = await router.speak('สวัสดี', router.resolveProfile(JARVIS_VOICE_ID), { turnId: 't-jarvis', text: 'สวัสดี' });
  assert.equal(result.status, 'spoken');
  assert.equal(result.profileId, JARVIS_VOICE_ID);
  assert.equal(result.fallback, false);
  assert.equal(result.timings.sourceEngine, 'edge');
  assert.equal(rvcCalls.length, 0);
  assert.ok(result.audioBase64);
});

test('cloned voice route requires consent, mapping, and RVC', async () => {
  const source = mockSynth();
  const consent = new MemoryCloneConsent();
  const router = new StandaloneVoiceRouter({
    synthesizer: source.synth,
    consent,
    rvc: {
      convert: async () => ({ audio: Buffer.from('rvc'), mime: 'audio/wav', latencyMs: 22 }),
      cancel: async () => undefined,
    },
    probeServices: async () => ({ qwenLoaded: true, asrReachable: true, jaittsReady: false, rvcReady: true }),
  });
  const profile: VoiceProfile = { profileId: GAM_VOICE_ID, kind: 'clone', usesRvc: true, speakerId: '12345' };
  const denied = await router.speak('hello', profile, { turnId: 't-deny', text: 'hello' });
  assert.equal(denied.status, 'unavailable');
  assert.match(denied.reason || '', /speech unavailable/i);
  assert.equal(denied.fallback, false);
  assert.equal(denied.audioBase64, undefined);

  consent.grant(GAM_VOICE_ID);
  const spoken = await router.speak('hello', profile, { turnId: 't-gam', text: 'hello' });
  assert.equal(spoken.status, 'spoken');
  assert.equal(spoken.timings.rvcMs, 22);
  assert.equal(spoken.spokenProfileId, GAM_VOICE_ID);
});

test('explicit fallback is only allowed when marked fallback', async () => {
  const source = mockSynth();
  const router = new StandaloneVoiceRouter({
    synthesizer: source.synth,
    consent: new MemoryCloneConsent(),
    probeServices: async () => ({ qwenLoaded: true, asrReachable: true, jaittsReady: false, rvcReady: false }),
  });
  const result = await router.speak('hi', { profileId: GAM_VOICE_ID, kind: 'clone', usesRvc: true }, { turnId: 't-fb', text: 'hi' });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.fallback, false);
  assert.equal(result.spokenProfileId, undefined);
});

test('turn cancellation and stale audio are rejected', async () => {
  const gate = new TurnGate();
  gate.take('old');
  gate.take('new');
  assert.equal(gate.isCancelled('old'), true);
  assert.equal(gate.isCurrent('new'), true);
  gate.cancel('new');
  assert.equal(gate.isCancelled('new'), true);

  let release!: () => void;
  const hang = new Promise<SourceTtsResult>(resolve => { release = () => resolve({ audio: silentAudio, mime: 'audio/mpeg', engine: 'edge', latencyMs: 5 }); });
  const router = new StandaloneVoiceRouter({
    synthesizer: {
      synthesize: async () => hang,
      cancel: async () => undefined,
    },
    probeServices: async () => ({ qwenLoaded: true, asrReachable: true, jaittsReady: false, rvcReady: false }),
  });
  const pending = router.speak('later', router.resolveProfile(JARVIS_VOICE_ID), { turnId: 'stale', text: 'later' });
  await Promise.resolve();
  await router.cancel('stale');
  release();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(result.audioBase64, undefined);
});

test('speech off skips synthesis', async () => {
  const source = mockSynth();
  const router = new StandaloneVoiceRouter({
    enabled: false,
    synthesizer: source.synth,
  });
  const result = await router.speak('hi', router.resolveProfile(JARVIS_VOICE_ID), { turnId: 'off', text: 'hi' });
  assert.equal(result.status, 'skipped');
  assert.equal(source.calls.length, 0);
});

test('typed ask does not speak unless requested; mic path can', async () => {
  const source = mockSynth();
  const router = new StandaloneVoiceRouter({
    synthesizer: source.synth,
    probeServices: async () => ({ qwenLoaded: true, asrReachable: true, jaittsReady: false, rvcReady: false }),
  });
  const lab = createJarvisLabRuntime({
    attachDefaultMemory: false,
    attachDefaultCapabilities: false,
    attachDefaultPresentation: false,
    attachDefaultSpeech: false,
    speech: router,
    core: new LocalLlmJarvisCore({ generateText: async () => 'ระบบทำงานอยู่' }),
  });
  const typed = await lab.ask({ text: 'hello from keyboard' });
  assert.equal(typed.speech, undefined);
  assert.equal(source.calls.length, 0);
  const spoken = await lab.ask({ text: 'hello from mic', speak: true, voiceProfileId: JARVIS_VOICE_ID });
  assert.equal(spoken.speech?.status, 'spoken');
  assert.equal(source.calls.length, 1);
});

test('Persona and Voice stay independent through speech', async () => {
  const source = mockSynth();
  const lab = createJarvisLabRuntime({
    attachDefaultMemory: false,
    speech: new StandaloneVoiceRouter({
      synthesizer: source.synth,
      probeServices: async () => ({ qwenLoaded: true, asrReachable: true, jaittsReady: false, rvcReady: false }),
    }),
    core: new LocalLlmJarvisCore({ generateText: async () => '31 degrees' }),
  });
  lab.selectPersona('jarvis-lab', GAM_PERSONA_ID);
  lab.selectVoice('jarvis-lab', JARVIS_VOICE_ID);
  const mixed = await lab.ask({ text: 'weather', speak: true });
  assert.equal(mixed.presented.personaProfileId, GAM_PERSONA_ID);
  assert.equal(mixed.presented.voiceProfileId, JARVIS_VOICE_ID);
  assert.equal(mixed.speech?.profileId, JARVIS_VOICE_ID);
  lab.selectPersona('jarvis-lab', JARVIS_PERSONA_ID);
  lab.selectVoice('jarvis-lab', GAM_VOICE_ID);
  const status = await lab.presentationStatus('jarvis-lab');
  assert.equal(status.persona.id, JARVIS_PERSONA_ID);
  assert.equal(status.voice.profileId, GAM_VOICE_ID);
});

test('resource policy never force-unloads Qwen and prefers Edge for native', () => {
  const policy = new StandaloneVoiceResourcePolicy();
  assert.equal(policy.getPhase(), 'listening');
  policy.enter('thinking');
  policy.enter('speaking');
  const native = policy.chooseSourceEngine('วันนี้ระบบ Jarvis ทำงานอยู่ไหม', resolveVoiceRoute(JARVIS_VOICE_ID), {
    qwenLoaded: true,
    asrReachable: true,
    jaittsReady: true,
    rvcReady: true,
  });
  assert.equal(native, 'edge');
  const clone = policy.chooseSourceEngine('วันนี้ระบบ Jarvis ทำงานอยู่ไหม', { profileId: 'gam', kind: 'clone', usesRvc: true, speakerId: '1' }, {
    qwenLoaded: true,
    asrReachable: true,
    jaittsReady: true,
    rvcReady: true,
  });
  assert.equal(clone, 'jaitts');
  const described = policy.describe();
  assert.equal(described.qwen, 'keep-warm');
  assert.equal(described.unload, 'none');
  policy.enter('listening');
  assert.equal(policy.getPhase(), 'listening');
});

test('Core does not import speech/TTS/RVC', async () => {
  const core = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'standalone', 'LocalLlmJarvisCore.ts'), 'utf8');
  assert.equal(core.includes('VoiceOutputRouter'), false);
  assert.equal(core.includes('JaiTTS'), false);
  assert.equal(core.includes('edgeTts'), false);
  const typed = await runStandaloneTextTurn({
    text: 'typed stays text',
    requestId: 'no-speech',
  }, {
    core: new LocalLlmJarvisCore({ generateText: async () => 'ok' }),
  });
  assert.match(typed.presented.text, /ok/);
  assert.equal('speech' in typed, false);
  void createJarvisRequest;
});

test('standalone speech modules stay Discord-free and do not persist conversational audio', () => {
  const files = [
    path.join(process.cwd(), 'src', 'jarvis', 'speech', 'StandaloneVoiceRouter.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'speech', 'edgeTts.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'speech', 'resourcePolicy.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'speech', 'consent.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'JarvisLabPage.tsx'),
  ];
  const discord = /from\s+['"](?:discord(?:\.js)?|@discordjs\/)['"]/u;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(discord.test(source), false, file);
    assert.equal(source.includes('RECORD_RAW_AUDIO'), false, file);
    assert.equal(source.includes('VoiceDatasetWriter'), false, file);
  }
});

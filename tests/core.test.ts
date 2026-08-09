import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import OpusScript from 'opusscript';
import { ConversationTimeline } from '../src/bot/timeline/ConversationTimeline';
import { GroupConversationState } from '../src/bot/brain/GroupConversationState';
import { SocialBrain } from '../src/bot/brain/SocialBrain';
import { FriendMemoryManager } from '../src/bot/memory/FriendMemoryManager';
import { LocalSpeechStream } from '../src/bot/stt/LocalSTTProvider';
import { LocalTTSProvider } from '../src/bot/tts/LocalTTSProvider';
import { SafeOpusDecoder } from '../src/bot/SafeOpusDecoder';
import { VoiceOutputManager } from '../src/bot/tts/VoiceOutputManager';
import { VoiceConnectionManager } from '../src/bot/VoiceConnectionManager';
import { TTSProvider } from '../src/bot/tts/TTSProvider';
import { ResponseGenerator } from '../src/bot/personality/ResponseGenerator';
import { VoiceConsentManager } from '../src/bot/voice/VoiceConsentManager';
import { ColabVoiceClient } from '../src/bot/voice/ColabVoiceClient';

interface SocialFixtureMessage {
  speaker: string;
  text: string;
  timestamp: number;
}

interface SocialFixture {
  id: string;
  context: SocialFixtureMessage[];
  expectedAction: string;
}

function createConversationState(messages: SocialFixtureMessage[]): GroupConversationState {
  const timeline = new ConversationTimeline();
  timeline.addEvent({
    type: 'VOICE_SESSION_STARTED',
    sessionId: 'test-session',
    guildId: 'test-guild',
    channelId: 'test-channel',
    timestamp: 0,
  });

  messages.forEach((message, index) => {
    timeline.addEvent({
      type: 'TRANSCRIPT_FINAL',
      eventId: `event-${index}`,
      sessionId: 'test-session',
      discordUserId: message.speaker,
      username: message.speaker,
      displayName: message.speaker,
      rawText: message.text,
      confidence: 0.99,
      timestamp: message.timestamp,
      speechStartedAt: message.timestamp - 100,
      speechEndedAt: message.timestamp,
      sttLatencyMs: 10,
    });
  });

  return new GroupConversationState(timeline);
}

test('Thai social fixtures produce their exact expected actions offline', async () => {
  const fixturePath = path.join(process.cwd(), 'tests', 'fixtures', 'thai_social_cases.jsonl');
  const fixtures = fs.readFileSync(fixturePath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(line => JSON.parse(line) as SocialFixture);

  const previousAliases = process.env.OWNER_ALIASES;
  const previousUnprompted = process.env.ALLOW_UNPROMPTED_RESPONSES;
  process.env.OWNER_ALIASES = 'Spin,สปิน';
  process.env.ALLOW_UNPROMPTED_RESPONSES = 'false';

  try {
    const brain = new SocialBrain('Spin');
    for (const fixture of fixtures) {
      const decision = await brain.evaluate(createConversationState(fixture.context));
      assert.equal(decision.action, fixture.expectedAction, fixture.id);
    }
  } finally {
    restoreEnvironment('OWNER_ALIASES', previousAliases);
    restoreEnvironment('ALLOW_UNPROMPTED_RESPONSES', previousUnprompted);
  }
});

test('newer game memory supersedes an older preference', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-memory-test-'));
  try {
    const manager = new FriendMemoryManager(path.join(tempDir, 'friends.json'));
    manager.evaluateAndWriteMemory('bank', 'Bank', 'กูชอบเล่น valo มาก');
    manager.evaluateAndWriteMemory('bank', 'Bank', 'กูเลิกเล่น valo ละ');

    const active = manager.getRelevantMemories('bank');
    assert.equal(active.length, 1);
    assert.match(active[0].fact, /เลิกเล่น valo/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('response generation prefers a matching owner behavior example', async () => {
  const state = createConversationState([
    { speaker: 'Anu', text: 'มึงเล่น valo ปะ', timestamp: 1000 },
  ]);
  const response = await new ResponseGenerator().generate({
    action: 'ANSWER',
    targetUserIds: ['Anu'],
    confidence: 1,
    directlyAddressed: true,
    responseExpected: 1,
    interruptAppropriate: false,
    desiredLength: 'very_short',
    tone: 'casual',
    reasonCode: 'TEST',
  }, state);

  assert.equal(response, 'ไม่อะ');
});

test('offline STT emits no fabricated transcript', async () => {
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousColabUrl = process.env.COLAB_TTS_URL;
  const previousColabSttUrl = process.env.COLAB_STT_URL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.COLAB_TTS_URL;
  delete process.env.COLAB_STT_URL;

  try {
    const stream = new LocalSpeechStream({
      userId: 'user',
      username: 'user',
      displayName: 'User',
      sessionId: 'session',
    }, 'http://127.0.0.1:1');
    let finalCount = 0;
    let endCount = 0;
    stream.on('final', () => finalCount++);
    stream.on('end', () => endCount++);
    stream.write(Buffer.alloc(192000));

    await stream.endStream();

    assert.equal(finalCount, 0);
    assert.equal(endCount, 1);
  } finally {
    restoreEnvironment('GEMINI_API_KEY', previousGeminiKey);
    restoreEnvironment('COLAB_TTS_URL', previousColabUrl);
    restoreEnvironment('COLAB_STT_URL', previousColabSttUrl);
  }
});

test('offline TTS returns unavailable instead of a synthetic tone', async () => {
  const previousColabUrl = process.env.COLAB_TTS_URL;
  const previousVoiceUrl = process.env.COLAB_VOICE_URL;
  delete process.env.COLAB_TTS_URL;
  delete process.env.COLAB_VOICE_URL;
  try {
    const provider = new LocalTTSProvider('http://127.0.0.1:1');
    assert.equal(await provider.synthesize('ทดสอบ'), null);
  } finally {
    restoreEnvironment('COLAB_TTS_URL', previousColabUrl);
    restoreEnvironment('COLAB_VOICE_URL', previousVoiceUrl);
  }
});

test('voice recording consent is explicit and scoped to a Discord server', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-consent-test-'));
  try {
    const samplesRoot = path.join(tempDir, 'voice_samples');
    const manager = new VoiceConsentManager(path.join(tempDir, 'voice_consents.json'), samplesRoot);
    assert.equal(manager.hasActiveConsent('guild-a', '1234567890'), false);
    manager.grant('guild-a', '1234567890', 'Owner');
    assert.equal(manager.hasActiveConsent('guild-a', '1234567890'), true);
    assert.equal(manager.hasActiveConsent('guild-b', '1234567890'), false);
    assert.equal(manager.hasActiveConsentAnywhere('1234567890'), true);
    manager.revoke('guild-a', '1234567890');
    assert.equal(manager.hasActiveConsent('guild-a', '1234567890'), false);

    const legacyFolder = path.join(samplesRoot, 'Owner');
    fs.mkdirSync(legacyFolder, { recursive: true });
    fs.writeFileSync(path.join(legacyFolder, 'old.wav'), Buffer.from('old-voice'));
    fs.writeFileSync(path.join(samplesRoot, 'catalog.json'), JSON.stringify([{
      userId: '1234567890',
      file: '/data/voice_samples/Owner/old.wav',
    }]));
    assert.equal(manager.deleteLocalSpeakerData('1234567890'), 1);
    assert.equal(fs.existsSync(path.join(legacyFolder, 'old.wav')), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(samplesRoot, 'catalog.json'), 'utf8')), []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('Colab voice uploads use raw WAV bodies and bearer authentication', async () => {
  const previousUrl = process.env.COLAB_VOICE_URL;
  const previousToken = process.env.COLAB_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.COLAB_VOICE_URL = 'https://voice.example.test/';
  process.env.COLAB_API_TOKEN = 'test-token-with-at-least-24-characters';
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      speakerId: '1234567890',
      sampleCount: 1,
      durationSeconds: 1,
      modelReady: false,
      job: null,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const wav = Buffer.from('RIFF-test-WAVE');
    await new ColabVoiceClient().uploadSample({
      guildId: 'guild-a',
      userId: '1234567890',
      displayName: 'เจ้าของ',
      filename: 'sample.wav',
      wavBuffer: wav,
    });
    assert.equal(capturedUrl, 'https://voice.example.test/v1/samples');
    const headers = new Headers(capturedInit?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-token-with-at-least-24-characters');
    assert.equal(headers.get('content-type'), 'audio/wav');
    assert.equal(headers.get('x-discord-user-id'), '1234567890');
    assert.deepEqual(capturedInit?.body, wav);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('COLAB_VOICE_URL', previousUrl);
    restoreEnvironment('COLAB_API_TOKEN', previousToken);
  }
});

test('Colab cloned TTS uses the selected Discord user model and auth token', async () => {
  const previousUrl = process.env.COLAB_VOICE_URL;
  const previousLegacyUrl = process.env.COLAB_TTS_URL;
  const previousToken = process.env.COLAB_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.COLAB_VOICE_URL = 'https://voice.example.test';
  delete process.env.COLAB_TTS_URL;
  process.env.COLAB_API_TOKEN = 'test-token-with-at-least-24-characters';
  let requestBody: any;
  let requestHeaders: Headers | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    requestHeaders = new Headers(init?.headers);
    return new Response(Buffer.from('wav-output'), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
  }) as typeof fetch;

  try {
    const result = await new LocalTTSProvider().synthesize('ทดสอบ', '1234567890');
    assert.deepEqual(result, Buffer.from('wav-output'));
    assert.equal(requestBody.speakerId, '1234567890');
    assert.equal(requestHeaders?.get('authorization'), 'Bearer test-token-with-at-least-24-characters');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('COLAB_VOICE_URL', previousUrl);
    restoreEnvironment('COLAB_TTS_URL', previousLegacyUrl);
    restoreEnvironment('COLAB_API_TOKEN', previousToken);
  }
});

test('safe Opus decoder produces PCM for a valid 20 ms stereo frame', async () => {
  const encoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO, { wasm: false });
  try {
    const pcmInput = Buffer.alloc(960 * 2 * 2);
    const encoded = Buffer.from(encoder.encode(pcmInput, 960));
    const decoder = new SafeOpusDecoder({ rate: 48000, channels: 2 });
    const chunks: Buffer[] = [];
    decoder.on('data', chunk => chunks.push(Buffer.from(chunk)));

    await new Promise<void>((resolve, reject) => {
      decoder.once('end', resolve);
      decoder.once('error', reject);
      Readable.from([encoded]).pipe(decoder);
    });

    assert.equal(Buffer.concat(chunks).length, pcmInput.length);
  } finally {
    encoder.delete();
  }
});

test('safe Opus decoder contains malformed packet failures', async () => {
  const decoder = new SafeOpusDecoder({ rate: 48000, channels: 2 });
  decoder.resume();
  await new Promise<void>((resolve, reject) => {
    decoder.once('end', resolve);
    decoder.once('error', reject);
    Readable.from([Buffer.from([0xbe, 0xde, 0x00])]).pipe(decoder);
  });
});

test('barge-in cancels a turn while TTS is still being generated', async () => {
  let releaseSynthesis: ((value: Buffer) => void) | undefined;
  const ttsProvider: TTSProvider = {
    synthesize: () => new Promise<Buffer>(resolve => {
      releaseSynthesis = resolve;
    }),
  };
  let playbackCalls = 0;
  const fakeVoiceManager = {
    playAudio: async () => {
      playbackCalls++;
      return true;
    },
    stopAudio: () => undefined,
  } as unknown as VoiceConnectionManager;
  const manager = new VoiceOutputManager(fakeVoiceManager, ttsProvider);

  const turn = manager.speakTurn('guild', 'ทดสอบ');
  await new Promise(resolve => setImmediate(resolve));
  manager.cancelCurrentTurn('guild');
  assert.ok(releaseSynthesis);
  releaseSynthesis(Buffer.from('audio'));

  assert.equal(await turn, false);
  assert.equal(playbackCalls, 0);
});

test('barge-in stops an active playback turn', async () => {
  let releasePlayback: (() => void) | undefined;
  let playbackStarted = false;
  const fakeVoiceManager = {
    playAudio: () => new Promise<boolean>(resolve => {
      playbackStarted = true;
      releasePlayback = () => resolve(true);
    }),
    stopAudio: () => releasePlayback?.(),
  } as unknown as VoiceConnectionManager;
  const ttsProvider: TTSProvider = {
    synthesize: async () => Buffer.from('audio'),
  };
  const manager = new VoiceOutputManager(fakeVoiceManager, ttsProvider);

  const turn = manager.speakTurn('guild', 'ทดสอบ');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(playbackStarted, true);
  manager.cancelCurrentTurn('guild');

  assert.equal(await turn, false);
});

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

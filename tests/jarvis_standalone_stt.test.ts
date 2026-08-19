import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { SpeechStream, type SpeechToTextProvider } from '../src/bot/stt/SpeechToTextProvider';
import {
  ScriptedAudioInput,
  SpeechTurnController,
  createSpeechJarvisRequest,
  describeBusyPolicy,
  makeSilencePcm,
  makeTonePcm,
  microphoneStartError,
  transcribeStandaloneUtterance,
} from '../src/jarvis/audio';
import { LocalLlmJarvisCore } from '../src/jarvis';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';
import { STT_PCM_CHANNELS, STT_PCM_SAMPLE_RATE } from '../src/jarvis/audio/types';

function framesOf(pcm: Uint8Array, frameMs = 20): { pcm: Uint8Array; sampleRate: number; channels: number; timestampMs: number }[] {
  const bytesPerFrame = Math.round(STT_PCM_SAMPLE_RATE * STT_PCM_CHANNELS * 2 * frameMs / 1_000);
  const frames = [];
  for (let offset = 0; offset < pcm.byteLength; offset += bytesPerFrame) {
    frames.push({
      pcm: pcm.subarray(offset, Math.min(pcm.byteLength, offset + bytesPerFrame)),
      sampleRate: STT_PCM_SAMPLE_RATE,
      channels: STT_PCM_CHANNELS,
      timestampMs: offset,
    });
  }
  return frames;
}

function feed(controller: SpeechTurnController, pcm: Uint8Array) {
  let last: ReturnType<SpeechTurnController['pushFrame']> | undefined;
  for (const frame of framesOf(pcm)) last = controller.pushFrame(frame);
  return last;
}

class ScriptStt implements SpeechToTextProvider {
  public writes = 0;
  constructor(private readonly mode: 'final' | 'noise' | 'unavailable' | 'timeout' | 'error') {}
  createStream(): SpeechStream {
    const stream = new SpeechStream();
    const originalWrite = stream.write.bind(stream);
    stream.write = buffer => {
      this.writes += buffer.length;
      originalWrite(buffer);
    };
    stream.endStream = async () => {
      if (this.mode === 'final') {
        stream.emit('final', 'สวัสดี Jarvis', 0.91, 44, { model: 'mock-qwen3-asr' });
      } else if (this.mode === 'noise') {
        stream.emit('nonSpeech', { subtype: 'NOISE', displayText: '[เสียงรบกวน]', durationMs: 80, reason: 'non_speech_audio' });
      } else if (this.mode === 'timeout') {
        stream.emit('error', Object.assign(new Error('STT timed out'), { code: 'STT_TIMEOUT' }));
      } else if (this.mode === 'unavailable') {
        stream.emit('error', Object.assign(new Error('connect ECONNREFUSED'), { code: 'STT_UNAVAILABLE' }));
      } else {
        stream.emit('error', new Error('stt exploded'));
      }
      stream.emit('end');
    };
    return stream;
  }
}

test('microphone unavailable and permission denied stay explicit', async () => {
  const missing = new ScriptedAudioInput({
    startError: microphoneStartError('unavailable', 'No capture device'),
  });
  await assert.rejects(() => missing.start(), /No capture device/);
  assert.equal(missing.getState(), 'unavailable');

  const denied = new ScriptedAudioInput({
    startError: microphoneStartError('permission-denied', 'Permission denied'),
  });
  await assert.rejects(() => denied.start(), /Permission denied/);
  assert.equal(denied.getState(), 'permission-denied');
});

test('start/stop capture without opening Discord audio', async () => {
  const input = new ScriptedAudioInput();
  const seen: number[] = [];
  const stop = input.onFrame(frame => seen.push(frame.pcm.byteLength));
  await input.start();
  assert.equal(input.getState(), 'capturing');
  input.emit({
    pcm: makeTonePcm(20),
    sampleRate: STT_PCM_SAMPLE_RATE,
    channels: STT_PCM_CHANNELS,
    timestampMs: 0,
  });
  await input.stop();
  assert.equal(input.getState(), 'idle');
  assert.equal(seen.length, 1);
  stop();
});

test('short and noise-only input is ignored; valid utterance is finalized', () => {
  const controller = new SpeechTurnController({
    endSilenceMs: 80,
    minimumVoicedMs: 80,
    maxCaptureMs: 4_000,
    idFactory: () => 'turn-1',
  });
  assert.equal(controller.startListening().ok, true);
  feed(controller, makeSilencePcm(200));
  const ignored = controller.stopListening();
  assert.equal(ignored.kind, 'ignored');

  const again = new SpeechTurnController({
    endSilenceMs: 80,
    minimumVoicedMs: 80,
    idFactory: () => 'turn-2',
  });
  again.startListening();
  again.pushFrame({
    pcm: makeTonePcm(400),
    sampleRate: STT_PCM_SAMPLE_RATE,
    channels: STT_PCM_CHANNELS,
    timestampMs: 0,
  });
  let utterance: ReturnType<SpeechTurnController['pushFrame']> | undefined;
  for (const frame of framesOf(makeSilencePcm(200))) {
    utterance = again.pushFrame(frame);
    if (utterance.kind !== 'listening') break;
  }
  assert.equal(utterance?.kind, 'utterance');
  if (utterance?.kind === 'utterance') {
    assert.equal(utterance.turn.turnId, 'turn-2');
    assert.ok(utterance.turn.pcm.byteLength > 0);
    assert.ok(utterance.turn.voicedMs >= 80);
  }
});

test('overlapping microphone turns are rejected while busy', () => {
  const controller = new SpeechTurnController({ idFactory: () => 'busy-1' });
  controller.setPipelineBusy(true);
  const rejected = controller.startListening();
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.reason, 'busy');
  assert.match(describeBusyPolicy(), /rejected while a turn is transcribing/i);
});

test('incomplete Thai ASR fragments stay reviewable and are not auto-final', async () => {
  class DanglingStt implements SpeechToTextProvider {
    createStream(): SpeechStream {
      const stream = new SpeechStream();
      stream.endStream = async () => {
        stream.emit('final', 'อาชีพใหม่ที่จะทำให้ตลาดซื้อขายใน', 0.7, 40, { model: 'mock-qwen3-asr' });
        stream.emit('end');
      };
      return stream;
    }
  }
  const result = await transcribeStandaloneUtterance(new DanglingStt(), makeTonePcm(200), { turnId: 't-dangle' });
  assert.equal(result.status, 'ignored');
  assert.equal(result.reason, 'incomplete-utterance');
  assert.equal(result.text, 'อาชีพใหม่ที่จะทำให้ตลาดซื้อขายใน');
  assert.equal(result.persisted, false);
});

test('STT success, unavailable, timeout, and ignored noise', async () => {
  const pcm = makeTonePcm(200);
  const ok = await transcribeStandaloneUtterance(new ScriptStt('final'), pcm, { turnId: 't-ok' });
  assert.equal(ok.status, 'final');
  assert.equal(ok.text, 'สวัสดี Jarvis');
  assert.equal(ok.persisted, false);
  assert.equal(ok.model, 'mock-qwen3-asr');

  const noise = await transcribeStandaloneUtterance(new ScriptStt('noise'), pcm, { turnId: 't-noise' });
  assert.equal(noise.status, 'ignored');

  const down = await transcribeStandaloneUtterance(new ScriptStt('unavailable'), pcm, { turnId: 't-down' });
  assert.equal(down.status, 'unavailable');

  const timeout = await transcribeStandaloneUtterance(new ScriptStt('timeout'), pcm, { turnId: 't-to' });
  assert.equal(timeout.status, 'timeout');

  const exploded = await transcribeStandaloneUtterance(new ScriptStt('error'), pcm, { turnId: 't-err' });
  assert.equal(exploded.status, 'error');
});

test('final transcript becomes a desktop JarvisRequest and typed ask still works', async () => {
  const request = createSpeechJarvisRequest({
    transcript: '  What is architecture.memory_backend?  ',
    turnId: 'mic-turn-9',
    sessionId: 'jarvis-lab',
  });
  assert.equal(request.source, 'desktop');
  assert.equal(request.requestId, 'mic-turn-9');
  assert.equal(request.input.text, 'What is architecture.memory_backend?');
  assert.ok(!('guildId' in request && typeof (request as { guildId?: unknown }).guildId === 'object'));

  const lab = createJarvisLabRuntime({
    attachDefaultMemory: false,
    attachDefaultCapabilities: false,
    attachDefaultPresentation: false,
    stt: new ScriptStt('final'),
    probeStt: async () => ({ reachable: true, baseUrl: 'http://127.0.0.1:8765', model: 'mock-qwen3-asr' }),
    core: new LocalLlmJarvisCore({ generateText: async () => 'typed still works' }),
    llm: {
      generateText: async () => 'typed still works',
      getRuntimeStatus: async () => ({ enabled: true, reachable: true, model: 'test' }),
    },
  });
  const status = await lab.status();
  assert.equal(status.discordRequired, false);
  assert.equal(status.stt.reachable, true);
  const spoken = await lab.transcribe({ pcm: makeTonePcm(200), turnId: 'mic-lab' });
  assert.equal(spoken.status, 'final');
  assert.equal(spoken.requestId, 'mic-lab');
  assert.ok(spoken.captureDurationMs > 0);
  assert.equal(spoken.persisted, false);
  const typed = await lab.ask({ text: 'hello from keyboard' });
  assert.match(typed.presented.text, /typed still works|hello/i);
});

test('standalone mic/STT modules do not depend on Discord or persist training audio', () => {
  const files = [
    path.join(process.cwd(), 'src', 'jarvis', 'audio', 'SpeechTurnController.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'audio', 'transcribeUtterance.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'audio', 'speechTurnRequest.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'browserMicrophone.ts'),
  ];
  const discord = /from\s+['"](?:discord(?:\.js)?|@discordjs\/|[^'"]*AudioReceiver|[^'"]*VoiceDatasetWriter)['"]/u;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(discord.test(source), false, file);
    assert.equal(source.includes('RECORD_RAW_AUDIO'), false, file);
    assert.equal(source.includes('VoiceDatasetWriter'), false, file);
    assert.equal(/writeFileSync/.test(source), false, file);
  }
  const transcribe = fs.readFileSync(path.join(process.cwd(), 'src', 'jarvis', 'audio', 'transcribeUtterance.ts'), 'utf8');
  assert.match(transcribe, /persistRejectedAudio: false/);
});

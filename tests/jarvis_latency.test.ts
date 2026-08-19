import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ollamaMetricsFromChat } from '../src/bot/llm/ollamaMetrics';
import { standaloneTranscriptIgnoreReason } from '../src/jarvis/audio/utteranceQuality';
import { SpeechTurnController } from '../src/jarvis/audio/SpeechTurnController';
import { memoryIntentFor } from '../src/jarvis/memory/intent';
import { compactTurnTimings } from '../src/jarvis/standalone/turnTimings';
import { applyJarvisInteractiveProfile, describeJarvisRuntimeProfile } from '../src/jarvis/standalone/runtimeProfile';
import { FactPreservingPresentationEngine, LocalLlmJarvisCore, createJarvisRequest, runStandaloneTextTurn } from '../src/jarvis';
import { formatTurnTimingsLine } from '../src/jarvis/ui/labUiState';
import { makeSilencePcm, makeTonePcm } from '../src/jarvis/audio/pcm';
import { STT_PCM_CHANNELS, STT_PCM_SAMPLE_RATE } from '../src/jarvis/audio/types';

test('ollama metrics omit unknown stages and convert nanoseconds', () => {
  const metrics = ollamaMetricsFromChat({
    prompt_eval_count: 40,
    prompt_eval_duration: 200_000_000,
    eval_count: 10,
    eval_duration: 500_000_000,
    load_duration: 1_000_000_000,
  }, { ttftMs: 120, promptChars: 80 });
  assert.equal(metrics.promptTokens, 40);
  assert.equal(metrics.outputTokens, 10);
  assert.equal(metrics.promptEvalMs, 200);
  assert.equal(metrics.generationMs, 500);
  assert.equal(metrics.loadMs, 1000);
  assert.equal(metrics.ttftMs, 120);
  assert.equal(metrics.tokensPerSec, 20);
  assert.equal(compactTurnTimings({ totalMs: 900, llmMs: 700 }).includes('stt'), false);
  assert.match(compactTurnTimings({ totalMs: 900, llmMs: 700 }), /llm 700ms/);
  assert.match(formatTurnTimingsLine({ totalMs: 900, llmTtftMs: 120 }) || '', /ttft 120ms/);
});

test('interactive profile does not apply the voice GPU cap', () => {
  const env: NodeJS.ProcessEnv = {
    JARVIS_STANDALONE: '1',
    LLM_KEEP_ALIVE: '10m',
    LLM_TIMEOUT_MS: '60000',
    LLM_CONTEXT_TOKENS: '8192',
    LLM_GPU_LAYERS: '999',
  };
  const profile = applyJarvisInteractiveProfile(env);
  assert.equal(profile.id, 'interactive');
  assert.equal(profile.keepAlive, '30m');
  assert.equal(profile.contextTokens, 4096);
  assert.equal(profile.timeoutMs, 120000);
  assert.equal(profile.gpuLayers, 999);
  assert.equal(profile.voiceGpuCapApplied, false);
  assert.equal(describeJarvisRuntimeProfile({ JARVIS_PROFILE: 'voice', LLM_GPU_LAYERS: '48' }).voiceGpuCapApplied, false);
});

test('start:local still contains the voice GPU coexistence cap', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'scripts', 'start_local.ts'), 'utf8');
  assert.match(source, /reserveGpuForLiveVoice/);
  assert.match(source, /LLM_VOICE_GPU_LAYERS/);
  assert.equal(source.includes('applyJarvisInteractiveProfile'), false);
});

test('memory intent skips arithmetic and capability ids but keeps fact keys', () => {
  assert.equal(memoryIntentFor('lab.ping'), 'skip');
  assert.equal(memoryIntentFor('ตอบว่า 2+2 เท่ากับอะไร แบบสั้นๆ'), 'skip');
  assert.equal(memoryIntentFor('What is architecture.memory_backend?'), 'fact-key');
  assert.equal(memoryIntentFor('unique mango-orbit query 1842'), 'lexical');
});

test('dangling incomplete Thai transcripts are ignored without persistence', () => {
  assert.equal(
    standaloneTranscriptIgnoreReason('อาชีพใหม่ที่จะทำให้ตลาดซื้อขายใน', { confidence: 0.7 }),
    'incomplete-utterance',
  );
  assert.equal(standaloneTranscriptIgnoreReason('สวัสดี Jarvis', { confidence: 0.9 }), undefined);
});

test('stricter default VAD ignores quiet noise', () => {
  const controller = new SpeechTurnController({
    idFactory: () => 'quiet-1',
    endSilenceMs: 80,
  });
  controller.startListening();
  controller.pushFrame({
    pcm: makeTonePcm(200, { amplitude: 0.002 }),
    sampleRate: STT_PCM_SAMPLE_RATE,
    channels: STT_PCM_CHANNELS,
    timestampMs: 0,
  });
  const ignored = controller.stopListening();
  assert.equal(ignored.kind, 'ignored');
  void makeSilencePcm;
});

test('draft streaming still runs Presentation Engine for the final text', async () => {
  const drafts: string[] = [];
  const core = new LocalLlmJarvisCore({
    generateText: async () => '31 degrees',
    generateTextDetailed: async request => {
      request.onDraft?.('31', '31');
      request.onDraft?.(' degrees', '31 degrees');
      return { text: '31 degrees' };
    },
  });
  const output = await runStandaloneTextTurn(
    {
      text: 'weather',
      requestId: 'stream-1',
      personaProfileId: 'gam-user',
    },
    {
      core,
      engine: new FactPreservingPresentationEngine(),
      onDraft: text => drafts.push(text),
    },
  );
  assert.deepEqual(drafts, ['31', '31 degrees']);
  assert.match(output.presented.text, /31 degrees/);
  assert.equal(output.presented.personaProfileId, 'gam-user');
  assert.ok(output.timings.totalMs >= 0);
  assert.ok(output.result.suggestedContent);
});

test('timed core result does not invent Ollama eval fields for mocks', async () => {
  const core = new LocalLlmJarvisCore({ generateText: async () => 'ok' });
  const timed = await core.handleTimed(createJarvisRequest({ text: 'hello', requestId: 't-1' }));
  assert.equal(timed.result.suggestedContent, 'ok');
  assert.equal(timed.llm, undefined);
  assert.ok(timed.timings.llmMs !== undefined);
  assert.equal(timed.timings.llmPromptEvalMs, undefined);
});

test('standalone latency modules stay Discord-free and do not persist audio', () => {
  const files = [
    path.join(process.cwd(), 'src', 'jarvis', 'standalone', 'runtimeProfile.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'standalone', 'turnTimings.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'audio', 'utteranceQuality.ts'),
  ];
  const discord = /from\s+['"](?:discord(?:\.js)?|@discordjs\/)['"]/u;
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(discord.test(source), false, file);
    assert.equal(source.includes('RECORD_RAW_AUDIO'), false, file);
    assert.equal(source.includes('VoiceDatasetWriter'), false, file);
  }
});

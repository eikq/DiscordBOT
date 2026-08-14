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
import { SocialDecision } from '../src/bot/brain/types';
import { FriendMemoryManager } from '../src/bot/memory/FriendMemoryManager';
import { LocalSpeechStream } from '../src/bot/stt/LocalSTTProvider';
import { LocalTTSProvider } from '../src/bot/tts/LocalTTSProvider';
import { SafeOpusDecoder } from '../src/bot/SafeOpusDecoder';
import { VoiceOutputManager } from '../src/bot/tts/VoiceOutputManager';
import { VoiceConnectionManager } from '../src/bot/VoiceConnectionManager';
import { TTSProvider } from '../src/bot/tts/TTSProvider';
import { ResponseGenerator } from '../src/bot/personality/ResponseGenerator';
import { SustainedVoiceDetector } from '../src/bot/audio/SustainedVoiceDetector';
import { LocalLlmProvider } from '../src/bot/llm/LocalLlmProvider';
import { VoiceConsentManager } from '../src/bot/voice/VoiceConsentManager';
import { VoiceServiceClient } from '../src/bot/voice/VoiceServiceClient';
import { getVoiceServiceBaseUrl } from '../src/bot/voice/VoiceServiceConfig';
import { VoiceCaptureTargetManager } from '../src/bot/voice/VoiceCaptureTargetManager';
import { VoiceDatasetWriter } from '../src/bot/voice/VoiceDatasetWriter';
import { analyzeVoiceUtterance } from '../src/bot/voice/VoiceUtteranceAnalyzer';
import { decideAutomaticTraining, LearningSessionController } from '../src/bot/voice/LearningSessionController';
import { PersonaProfileManager } from '../src/bot/personality/PersonaProfileManager';
import { BehaviorRetriever } from '../src/bot/personality/BehaviorRetriever';
import { SocialMemoryBrain } from '../src/bot/memory/SocialMemoryBrain';
import { TranscriptFinalEvent } from '../src/bot/types/events';
import { looksLikeConversationalQuestion } from '../src/bot/brain/QuestionDetector';

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

function createStereoSinePcm(durationSeconds: number, frequencyHz: number, amplitude: number): Buffer {
  const frameCount = Math.round(48_000 * durationSeconds);
  const pcm = Buffer.alloc(frameCount * 4);
  for (let frame = 0; frame < frameCount; frame++) {
    const sample = Math.round(Math.sin(2 * Math.PI * frequencyHz * frame / 48_000) * amplitude * 32767);
    pcm.writeInt16LE(sample, frame * 4);
    pcm.writeInt16LE(sample, frame * 4 + 2);
  }
  return pcm;
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

test('selected cloned persona owns its name aliases instead of the legacy Spin identity', async () => {
  const previousUnprompted = process.env.ALLOW_UNPROMPTED_RESPONSES;
  process.env.ALLOW_UNPROMPTED_RESPONSES = 'false';
  const persona = {
    userId: '897089867752808479',
    displayName: 'Gam',
    aliases: ['Gam', 'Gam0565', 'แก้ม'],
    description: 'เพื่อนในกลุ่ม',
    updatedAt: Date.now(),
  };

  try {
    const gamDecision = await new SocialBrain('Digital Me').evaluate(createConversationState([
      { speaker: 'Bank', text: 'แก้ม คืนนี้เล่นปะ', timestamp: 1000 },
    ]), persona);
    const spinDecision = await new SocialBrain('Digital Me').evaluate(createConversationState([
      { speaker: 'Bank', text: 'สปิน คืนนี้เล่นปะ', timestamp: 1000 },
    ]), persona);

    assert.equal(gamDecision.action, 'ANSWER');
    assert.equal(spinDecision.action, 'IGNORE');
  } finally {
    restoreEnvironment('ALLOW_UNPROMPTED_RESPONSES', previousUnprompted);
  }
});

test('one-on-one voice conversation responds without repeating the persona name', async () => {
  const previousOneOnOne = process.env.RESPOND_IN_ONE_ON_ONE;
  const previousUnprompted = process.env.ALLOW_UNPROMPTED_RESPONSES;
  process.env.RESPOND_IN_ONE_ON_ONE = 'true';
  process.env.ALLOW_UNPROMPTED_RESPONSES = 'false';
  try {
    const state = createConversationState([
      { speaker: 'Owner', text: 'เมื่อกี้กูแพ้อีกแล้ว', timestamp: 1000 },
    ]);
    const brain = new SocialBrain('Digital Me');
    const directConversation = await brain.evaluate(state, null, { oneOnOneVoiceConversation: true });
    const groupConversation = await brain.evaluate(state, null, { oneOnOneVoiceConversation: false });

    assert.equal(directConversation.action, 'SHORT_REACTION');
    assert.equal(directConversation.reasonCode, 'ONE_ON_ONE_CONVERSATION');
    assert.equal(groupConversation.action, 'IGNORE');
  } finally {
    restoreEnvironment('RESPOND_IN_ONE_ON_ONE', previousOneOnOne);
    restoreEnvironment('ALLOW_UNPROMPTED_RESPONSES', previousUnprompted);
  }
});

test('Thai spoken questions without punctuation are answered instead of short-reacted', async () => {
  const previousOneOnOne = process.env.RESPOND_IN_ONE_ON_ONE;
  process.env.RESPOND_IN_ONE_ON_ONE = 'true';
  const persona = {
    userId: '897089867752808479', displayName: 'Gam', aliases: ['Gam', 'แก้ม'], description: '', updatedAt: 0,
  };
  try {
    assert.equal(looksLikeConversationalQuestion('กินข้าวยัง'), true);
    assert.equal(looksLikeConversationalQuestion('ทำไรอยู่'), true);
    assert.equal(looksLikeConversationalQuestion('ยัง'), false);

    const oneOnOne = await new SocialBrain('Digital Me').evaluate(createConversationState([
      { speaker: 'Friend', text: 'กินข้าวยัง', timestamp: 1000 },
    ]), persona, { oneOnOneVoiceConversation: true });
    const addressed = await new SocialBrain('Digital Me').evaluate(createConversationState([
      { speaker: 'Friend', text: 'แก้ม กินข้าวยัง', timestamp: 1000 },
    ]), persona, { oneOnOneVoiceConversation: false });
    const aliasAtEnd = await new SocialBrain('Digital Me').evaluate(createConversationState([
      { speaker: 'Friend', text: 'เอาปะ Gam', timestamp: 1000 },
    ]), persona, { oneOnOneVoiceConversation: false });

    assert.equal(oneOnOne.action, 'ANSWER');
    assert.equal(oneOnOne.reasonCode, 'ONE_ON_ONE_QUESTION');
    assert.equal(addressed.action, 'ANSWER');
    assert.equal(addressed.reasonCode, 'DIRECT_QUESTION_TARGETED');
    assert.equal(aliasAtEnd.action, 'ANSWER');
    assert.equal(aliasAtEnd.reasonCode, 'DIRECT_QUESTION_TARGETED');
  } finally {
    restoreEnvironment('RESPOND_IN_ONE_ON_ONE', previousOneOnOne);
  }
});

test('unprompted group classification uses the low-latency action-only request', async () => {
  const previousUnprompted = process.env.ALLOW_UNPROMPTED_RESPONSES;
  process.env.ALLOW_UNPROMPTED_RESPONSES = 'true';
  try {
    const brain = new SocialBrain('Digital Me');
    let capturedRequest: any;
    let classificationCalls = 0;
    (brain as any).localLlm = {
      generateStructured: async (request: any) => {
        classificationCalls++;
        capturedRequest = request;
        return { action: 'SHORT_REACTION' };
      },
    };
    const decision = await brain.evaluate(createConversationState([
      { speaker: 'Friend', text: 'เกมนี้อย่างฮา', timestamp: 1000 },
    ]), {
      userId: '897089867752808479',
      displayName: 'Gam',
      aliases: ['Gam', 'แกม'],
      description: '',
      updatedAt: 0,
    }, { oneOnOneVoiceConversation: false });

    assert.equal(decision.action, 'SHORT_REACTION');
    assert.equal(capturedRequest.maxTokens, 20);
    assert.match(capturedRequest.systemPrompt, /one key named action/i);
    brain.recordBotSpoke();
    const cooldownDecision = await brain.evaluate(createConversationState([
      { speaker: 'Friend', text: 'พูดต่ออีกประโยค', timestamp: 2000 },
    ]), null, { oneOnOneVoiceConversation: false });
    assert.equal(cooldownDecision.action, 'IGNORE');
    assert.equal(cooldownDecision.reasonCode, 'SOCIAL_COOLDOWN');
    assert.equal(classificationCalls, 1);
  } finally {
    restoreEnvironment('ALLOW_UNPROMPTED_RESPONSES', previousUnprompted);
  }
});

test('persona profiles derive a natural short alias and persist custom nicknames', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-persona-test-'));
  try {
    const manager = new PersonaProfileManager(path.join(tempDir, 'personas.json'));
    const derived = manager.ensure('897089867752808479', 'Gam0565');
    assert.ok(derived.aliases.some(alias => alias.toLowerCase() === 'gam'));

    manager.save('897089867752808479', 'Gam', ['แก้ม', 'GAM'], 'พูดสั้นๆ');
    const saved = new PersonaProfileManager(path.join(tempDir, 'personas.json')).get('897089867752808479');
    assert.equal(saved?.displayName, 'Gam');
    assert.ok(saved?.aliases.includes('แก้ม'));
    assert.equal(saved?.aliases.filter(alias => alias.toLowerCase() === 'gam').length, 1);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('behavior examples are isolated to the selected cloned persona', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-behavior-test-'));
  try {
    const examplesPath = path.join(tempDir, 'examples.json');
    fs.writeFileSync(examplesPath, JSON.stringify([
      { conversationId: 'gam', context: [{ speaker: 'Bank', text: 'แก้ม เล่นปะ' }], ownerAction: 'ANSWER', ownerResponse: 'เอาดิ', responseDelayMs: 1, relationship: 'friend', directlyAddressed: true, topic: 'gaming', personaUserId: '897089867752808479' },
      { conversationId: 'spin', context: [{ speaker: 'Bank', text: 'สปิน เล่นปะ' }], ownerAction: 'ANSWER', ownerResponse: 'ไม่อะ', responseDelayMs: 1, relationship: 'friend', directlyAddressed: true, topic: 'gaming', personaUserId: '553885301597011968' },
    ]));
    const retriever = new BehaviorRetriever(examplesPath);
    assert.equal(retriever.retrieveRelevant('ANSWER', 3, '897089867752808479')[0]?.ownerResponse, 'เอาดิ');
    assert.equal(retriever.retrieveRelevant('ANSWER', 3, '553885301597011968')[0]?.ownerResponse, 'ไม่อะ');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('social brain builds people, aliases, games, activities, relationships, and an Obsidian vault', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-social-brain-test-'));
  const previousMemoryEnabled = process.env.MEMORY_ENABLED;
  process.env.MEMORY_ENABLED = 'true';
  try {
    const brain = new SocialMemoryBrain(tempDir);
    brain.registerAliases('897089867752808479', 'Gam', ['Gam', 'แก้ม']);
    const first: TranscriptFinalEvent = {
      type: 'TRANSCRIPT_FINAL', eventId: 'one', sessionId: 'session', discordUserId: '553885301597011968',
      username: '_eikq_', displayName: '_eikq_', rawText: 'แก้ม เข้า valo ปะ', confidence: 0.9,
      timestamp: 1000, speechStartedAt: 900, speechEndedAt: 1000, sttLatencyMs: 10,
    };
    const second: TranscriptFinalEvent = {
      type: 'TRANSCRIPT_FINAL', eventId: 'two', sessionId: 'session', discordUserId: '897089867752808479',
      username: 'Gam0565', displayName: 'Gam0565', rawText: 'เออ เล่น valo อยู่', confidence: 0.9,
      timestamp: 2000, speechStartedAt: 1900, speechEndedAt: 2000, sttLatencyMs: 10,
    };
    brain.recordTranscript('guild', first, [first]);
    brain.recordTranscript('guild', second, [first, second]);
    const snapshot = brain.getSnapshot();

    assert.equal(snapshot.totalObservations, 2);
    assert.equal(snapshot.people.find(person => person.userId === second.discordUserId)?.games.Valorant.count, 1);
    assert.equal(snapshot.people.find(person => person.userId === second.discordUserId)?.activities.gaming.count, 1);
    assert.ok(snapshot.relationships.some(relationship => relationship.userIds.includes(first.discordUserId) && relationship.userIds.includes(second.discordUserId)));
    assert.equal(brain.search('valo').length, 2);
    assert.match(brain.getContextForTurn([second]), /Valorant/);
    assert.ok(fs.existsSync(path.join(brain.exportVault(), 'Brain Dashboard.md')));
  } finally {
    restoreEnvironment('MEMORY_ENABLED', previousMemoryEnabled);
    fs.rmSync(tempDir, { recursive: true, force: true });
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

test('social memory ignores low-confidence fact changes and supersedes contradictions with evidence', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-social-contradiction-test-'));
  const previousMemoryEnabled = process.env.MEMORY_ENABLED;
  process.env.MEMORY_ENABLED = 'true';
  const event = (eventId: string, text: string, confidence: number, timestamp: number): TranscriptFinalEvent => ({
    type: 'TRANSCRIPT_FINAL', eventId, sessionId: 'session', discordUserId: '123456789012345678',
    username: 'friend', displayName: 'Friend', rawText: text, confidence, timestamp,
    speechStartedAt: timestamp - 500, speechEndedAt: timestamp, sttLatencyMs: 20,
  });
  try {
    const brain = new SocialMemoryBrain(tempDir);
    const likes = event('likes', 'I like valorant', 0.95, 1_000);
    const noisyContradiction = event('noisy', 'I hate valorant', 0.4, 2_000);
    const confirmedContradiction = event('hates', 'I hate valorant', 0.95, 3_000);
    brain.recordTranscript('guild', likes, [likes]);
    brain.recordTranscript('guild', noisyContradiction, [likes, noisyContradiction]);
    let person = brain.getSnapshot().people[0];
    assert.equal(person.facts.filter(fact => fact.status === 'active').length, 1);
    assert.equal(person.facts.find(fact => fact.status === 'active')?.polarity, 'positive');

    brain.recordTranscript('guild', confirmedContradiction, [likes, noisyContradiction, confirmedContradiction]);
    person = brain.getSnapshot().people[0];
    assert.equal(person.facts.find(fact => fact.status === 'active')?.polarity, 'negative');
    assert.equal(person.facts.find(fact => fact.polarity === 'positive')?.status, 'superseded');
    assert.equal(brain.getSnapshot().recentObservations[0].transcriptConfidence, 0.95);
  } finally {
    restoreEnvironment('MEMORY_ENABLED', previousMemoryEnabled);
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

test('short reactions bypass the LLM so acknowledgement can start immediately', async () => {
  let llmCalls = 0;
  const localLlm = {
    generateText: async () => {
      llmCalls++;
      throw new Error('SHORT_REACTION must not call the LLM');
    },
  } as unknown as LocalLlmProvider;
  const state = createConversationState([
    { speaker: 'Friend', text: 'ฮัลโหลฮัลโหล', timestamp: 1000 },
  ]);
  const generator = new ResponseGenerator({ localLlm });
  const response = await generator.generate({
    action: 'SHORT_REACTION', targetUserIds: ['Friend'], confidence: 1,
    directlyAddressed: true, responseExpected: 1, interruptAppropriate: false,
    desiredLength: 'very_short', tone: 'casual', reasonCode: 'ONE_ON_ONE_CONVERSATION',
  }, state, {
    userId: 'unique-persona', displayName: 'Gam', aliases: ['Gam'],
    description: '', updatedAt: 0,
  });

  assert.equal(response, 'ว่าไง');
  assert.equal(llmCalls, 0);
});

test('short reactions follow context and do not repeat one filler forever', async () => {
  let llmCalls = 0;
  const localLlm = {
    generateText: async () => {
      llmCalls++;
      throw new Error('SHORT_REACTION must not call the LLM');
    },
  } as unknown as LocalLlmProvider;
  const generator = new ResponseGenerator({ localLlm });
  const decision: SocialDecision = {
    action: 'SHORT_REACTION', targetUserIds: ['Friend'], confidence: 1,
    directlyAddressed: false, responseExpected: 0.5, interruptAppropriate: false,
    desiredLength: 'very_short', tone: 'casual', reasonCode: 'TEST',
  };

  const reactions = await Promise.all([
    generator.generate(decision, createConversationState([
      { speaker: 'Friend', text: 'ฮัลโหล', timestamp: 1000 },
    ])),
    generator.generate(decision, createConversationState([
      { speaker: 'Friend', text: 'แพ้อีกแล้ว', timestamp: 2000 },
    ])),
    generator.generate(decision, createConversationState([
      { speaker: 'Friend', text: '555 อย่างฮา', timestamp: 3000 },
    ])),
  ]);

  assert.equal(new Set(reactions).size, reactions.length);
  assert.equal(reactions.includes('เออ'), false);
  assert.equal(llmCalls, 0);
});

test('response generator upgrades a misclassified question and answers its content', async () => {
  let llmCalls = 0;
  const localLlm = {
    generateText: async (request: any) => {
      llmCalls++;
      assert.match(request.userPrompt, /คำถามที่ต้องตอบโดยตรง: ใช่/u);
      return 'ว่างดิ มึงอะ';
    },
  } as any;
  const generator = new ResponseGenerator({ localLlm });
  const response = await generator.generate({
    action: 'SHORT_REACTION', targetUserIds: ['Friend'], confidence: 1,
    directlyAddressed: true, responseExpected: 1, interruptAppropriate: false,
    desiredLength: 'very_short', tone: 'curious', reasonCode: 'MISCLASSIFIED_TEST',
  }, createConversationState([
    { speaker: 'Friend', text: 'คืนนี้ว่างไหม', timestamp: 1000 },
  ]), {
    userId: '897089867752808479', displayName: 'Gam', aliases: ['Gam', 'แก้ม'], description: '', updatedAt: 0,
  });

  assert.equal(llmCalls, 1);
  assert.equal(response, 'ว่างดิ มึงอะ');
  assert.ok(!['จริงดิ', 'เอาดิ', 'เอาดี', 'ห้ะ', 'อ๋อ'].includes(response || ''));
});

test('daily eating question always gets a direct answer even when the LLM is unavailable', async () => {
  const localLlm = {
    generateText: async () => { throw new Error('Daily question should be handled before the LLM.'); },
  } as any;
  const response = await new ResponseGenerator({ localLlm }).generate({
    action: 'ANSWER', targetUserIds: ['Friend'], confidence: 1,
    directlyAddressed: true, responseExpected: 1, interruptAppropriate: false,
    desiredLength: 'short', tone: 'curious', reasonCode: 'ONE_ON_ONE_QUESTION',
  }, createConversationState([
    { speaker: 'Friend', text: 'กินข้าวยัง', timestamp: 1000 },
  ]), {
    userId: '897089867752808479', displayName: 'Gam', aliases: ['Gam', 'แก้ม'], description: '', updatedAt: 0,
  });

  assert.match(response || '', /(?:ยัง|กินแล้ว|ไม่ได้กิน|เพิ่งกิน)/u);
  assert.ok(!['จริงดิ', 'เอาดิ', 'เอาดี', 'ห้ะ', 'อ๋อ'].includes(response || ''));
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

test('local STT sends a brief 300ms spoken phrase for transcription', async () => {
  const previousFetch = globalThis.fetch;
  const previousMinimum = process.env.STT_MIN_AUDIO_MS;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls++;
    return new Response(JSON.stringify({ text: 'แกม', language: 'Thai', model: 'test-asr' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  process.env.STT_MIN_AUDIO_MS = '250';
  try {
    const stream = new LocalSpeechStream({
      userId: 'user', username: 'user', displayName: 'User', sessionId: 'session',
    }, 'http://127.0.0.1:8765');
    let transcript = '';
    stream.on('final', text => { transcript = text; });
    stream.write(Buffer.alloc(48_000 * 2 * 2 * 0.3, 1));
    await stream.endStream();

    assert.equal(fetchCalls, 1);
    assert.equal(transcript, 'แกม');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnvironment('STT_MIN_AUDIO_MS', previousMinimum);
  }
});

test('local STT applies editable gaming vocabulary corrections with clean boundaries', () => {
  const stream = new LocalSpeechStream({
    userId: 'user',
    username: 'user',
    displayName: 'User',
    sessionId: 'session',
  });
  const normalize = (stream as unknown as { normalizeWithDict(text: string): string }).normalizeWithDict.bind(stream);
  assert.equal(
    normalize('เพิ่มมูฟสปีดแล้ววิ่งเข้าไปเลย'),
    'เพิ่ม move speed แล้ววิ่งเข้าไปเลย',
  );
});

test('local STT rejects prompt echoes instead of feeding them to the brain', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    text: 'Move speed, movespeed, movement speed, attack speed, cooldown, damage, item, build.',
    classification: 'speech',
    diagnostics: { durationSeconds: 1.2, rmsDbfs: -24, speechConfidence: 0.9 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  try {
    const stream = new LocalSpeechStream({
      userId: 'user', username: 'user', displayName: 'User', sessionId: 'session',
    });
    let finalCount = 0;
    let noiseText = '';
    stream.on('final', () => finalCount++);
    stream.on('nonSpeech', event => { noiseText = event.displayText; });
    stream.write(Buffer.alloc(48_000 * 2 * 2));
    await stream.endStream();
    assert.equal(finalCount, 0);
    assert.equal(noiseText, '[เสียงรบกวน]');
  } finally {
    globalThis.fetch = previousFetch;
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

test('voice capture target restricts recording to the selected consented user', () => {
  const targets = new VoiceCaptureTargetManager();
  assert.equal(targets.allowsCapture('guild-a', 'user-a'), false);
  assert.equal(targets.allowsCapture('guild-a', 'user-b'), false);

  targets.set('guild-a', 'user-b');
  assert.equal(targets.allowsCapture('guild-a', 'user-a'), false);
  assert.equal(targets.allowsCapture('guild-a', 'user-b'), true);
  assert.equal(targets.allowsCapture('guild-b', 'user-a'), false);

  targets.removeUser('user-b');
  assert.equal(targets.get('guild-a'), undefined);
  assert.equal(targets.allowsCapture('guild-a', 'user-a'), false);
});

test('voice dataset writer keeps WAV, Thai-English TXT, and JSON metadata matched', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-dataset-test-'));
  try {
    const writer = new VoiceDatasetWriter(tempDir);
    const pcm = Buffer.alloc(48_000 * 2 * 2, 7);
    const saved = writer.save({
      guildId: 'guild-a',
      sessionId: 'session-a',
      eventId: 'event-a',
      userId: '123456789012345678',
      username: 'friend_user',
      displayName: 'เพื่อน Friend',
      speechStartedAt: 1_000,
      speechEndedAt: 2_000,
      pcmBuffer: pcm,
      transcript: {
        text: 'สวัสดีครับ hello everyone',
        confidence: 0.97,
        latencyMs: 123,
      },
    });

    assert.equal(saved.wavBuffer.subarray(0, 4).toString('ascii'), 'RIFF');
    assert.equal(saved.wavBuffer.subarray(8, 12).toString('ascii'), 'WAVE');
    assert.equal(saved.record.durationSeconds, 1);

    const speakerDir = path.join(tempDir, '123456789012345678');
    const transcriptPath = path.join(speakerDir, path.basename(saved.record.transcriptFile));
    assert.equal(fs.readFileSync(transcriptPath, 'utf8'), 'สวัสดีครับ hello everyone');

    const dataset = JSON.parse(fs.readFileSync(path.join(speakerDir, 'utterances.json'), 'utf8'));
    assert.equal(dataset.schemaVersion, 2);
    assert.equal(dataset.speaker.username, 'friend_user');
    assert.equal(dataset.utterances.length, 1);
    assert.equal(dataset.utterances[0].transcript.text, 'สวัสดีครับ hello everyone');
    assert.deepEqual(dataset.utterances[0].languageHints, ['th', 'en']);
    assert.equal(dataset.utterances[0].schemaVersion, 2);
    assert.equal(typeof dataset.utterances[0].analysis.quality.score, 'number');
    assert.equal(fs.existsSync(path.join(speakerDir, path.basename(saved.record.metadataFile))), true);

    const catalog = JSON.parse(fs.readFileSync(path.join(tempDir, 'catalog.json'), 'utf8'));
    assert.equal(catalog[0].file, saved.record.audioFile);
    assert.equal(catalog[0].transcriptFile, saved.record.transcriptFile);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('voice utterance analyzer accepts clean speech-like audio and rejects silence', () => {
  const cleanPcm = createStereoSinePcm(2, 190, 0.2);
  const clean = analyzeVoiceUtterance(cleanPcm, {
    text: 'สวัสดีครับ hello friend', confidence: 0.95, latencyMs: 100,
  });
  assert.equal(clean.quality.acceptedForVoiceTraining, true);
  assert.equal(clean.quality.acceptedForExpressiveTts, true);
  assert.ok((clean.prosody.pitchMedianHz ?? 0) >= 150);
  assert.equal(clean.transcript.hasThai, true);
  assert.equal(clean.transcript.hasEnglish, true);

  const overlapped = analyzeVoiceUtterance(cleanPcm, {
    text: 'overlapping speech', confidence: 0.95, latencyMs: 100,
  }, { suspectedOverlap: true });
  assert.equal(overlapped.quality.acceptedForVoiceTraining, true);
  assert.equal(overlapped.quality.suspectedOverlap, true);
  assert.equal(overlapped.quality.reasons.includes('overlapping_speakers'), false);

  const silence = analyzeVoiceUtterance(Buffer.alloc(48_000 * 2 * 2), null);
  assert.equal(silence.quality.acceptedForVoiceTraining, false);
  assert.ok(silence.quality.reasons.includes('too_little_audible_speech'));
  assert.ok(silence.quality.reasons.includes('audio_too_quiet'));
});

test('learning session freezes a versioned manifest containing only accepted training IDs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-learning-session-test-'));
  const sessionsRoot = path.join(tempDir, 'sessions');
  const samplesRoot = path.join(tempDir, 'samples');
  try {
    const controller = new LearningSessionController(sessionsRoot, samplesRoot);
    const session = controller.start({
      guildId: 'guild-a',
      targetUserId: '123456789012345678',
      targetUsername: 'friend_user',
      targetDisplayName: 'Friend',
      startedByUserId: '987654321098765432',
    });
    const writer = new VoiceDatasetWriter(samplesRoot);
    const accepted = writer.save({
      guildId: 'guild-a', sessionId: 'voice-a', learningSessionId: session.id, eventId: 'clean',
      userId: '123456789012345678', username: 'friend_user', displayName: 'Friend',
      speechStartedAt: 1_000, speechEndedAt: 3_000, pcmBuffer: createStereoSinePcm(2, 190, 0.2),
      transcript: { text: 'ชอบเล่น valorant มาก', confidence: 0.96, latencyMs: 50 },
    });
    const rejected = writer.save({
      guildId: 'guild-a', sessionId: 'voice-a', learningSessionId: session.id, eventId: 'silence',
      userId: '123456789012345678', username: 'friend_user', displayName: 'Friend',
      speechStartedAt: 4_000, speechEndedAt: 5_000, pcmBuffer: Buffer.alloc(48_000 * 2 * 2),
      transcript: null,
    });
    controller.recordUtterance('guild-a', accepted.record);
    controller.recordUtterance('guild-a', rejected.record);
    const stopped = controller.stop('guild-a', 'test');

    assert.ok(stopped?.datasetVersionId);
    assert.equal(stopped?.counters.capturedClips, 2);
    assert.equal(stopped?.counters.acceptedVoiceClips, 1);
    assert.equal(stopped?.counters.rejectedClips, 1);
    const manifestPath = path.join(samplesRoot, '123456789012345678', 'versions', `${stopped?.datasetVersionId}.json`);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.acceptedVoiceTrainingUtteranceIds, [accepted.record.id]);
    assert.equal(manifest.utterances.length, 2);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('an active learning session resumes after a local application restart', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-learning-resume-test-'));
  const previousResume = process.env.LEARNING_RESUME_AFTER_RESTART;
  process.env.LEARNING_RESUME_AFTER_RESTART = 'true';
  try {
    const sessionsRoot = path.join(tempDir, 'sessions');
    const samplesRoot = path.join(tempDir, 'samples');
    const first = new LearningSessionController(sessionsRoot, samplesRoot);
    const started = first.start({
      guildId: 'guild-resume', targetUserId: '123456789012345678',
      targetUsername: 'gam', targetDisplayName: 'Gam', startedByUserId: 'owner',
    });

    const restarted = new LearningSessionController(sessionsRoot, samplesRoot);
    const resumed = restarted.getActive('guild-resume');
    assert.equal(resumed?.id, started.id);
    assert.equal(resumed?.status, 'listening');
  } finally {
    restoreEnvironment('LEARNING_RESUME_AFTER_RESTART', previousResume);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('automatic learning chooses first training, best-model fine-tuning, or more collection deterministically', () => {
  assert.equal(decideAutomaticTraining({
    modelReady: false, serviceDurationSeconds: 130, newAcceptedSeconds: 20,
    jobStatus: null, minimumFreshSeconds: 120, minimumFinetuneSeconds: 180,
  }).action, 'fresh');
  assert.equal(decideAutomaticTraining({
    modelReady: true, serviceDurationSeconds: 500, newAcceptedSeconds: 200,
    jobStatus: 'ready', minimumFreshSeconds: 120, minimumFinetuneSeconds: 180,
  }).action, 'finetune');
  assert.equal(decideAutomaticTraining({
    modelReady: true, serviceDurationSeconds: 500, newAcceptedSeconds: 20,
    jobStatus: 'ready', minimumFreshSeconds: 120, minimumFinetuneSeconds: 180,
  }).action, 'none');
  assert.equal(decideAutomaticTraining({
    modelReady: true, serviceDurationSeconds: 500, newAcceptedSeconds: 500,
    jobStatus: 'training', minimumFreshSeconds: 120, minimumFinetuneSeconds: 180,
  }).action, 'wait');
});

test('local voice backend ignores a stale Colab tunnel URL', () => {
  const previousBackend = process.env.VOICE_BACKEND;
  const previousServiceUrl = process.env.VOICE_SERVICE_URL;
  const previousTtsUrl = process.env.TTS_BASE_URL;
  const previousColabUrl = process.env.COLAB_VOICE_URL;
  process.env.VOICE_BACKEND = 'local';
  delete process.env.VOICE_SERVICE_URL;
  process.env.TTS_BASE_URL = 'http://127.0.0.1:8766/';
  process.env.COLAB_VOICE_URL = 'https://expired.trycloudflare.com';
  try {
    assert.equal(getVoiceServiceBaseUrl(), 'http://127.0.0.1:8766');
  } finally {
    restoreEnvironment('VOICE_BACKEND', previousBackend);
    restoreEnvironment('VOICE_SERVICE_URL', previousServiceUrl);
    restoreEnvironment('TTS_BASE_URL', previousTtsUrl);
    restoreEnvironment('COLAB_VOICE_URL', previousColabUrl);
  }
});

test('local voice uploads use raw WAV bodies and bearer authentication', async () => {
  const previousUrl = process.env.VOICE_SERVICE_URL;
  const previousToken = process.env.VOICE_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.VOICE_SERVICE_URL = 'http://127.0.0.1:8766/';
  process.env.VOICE_API_TOKEN = 'test-token-with-at-least-24-characters';
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
    await new VoiceServiceClient().uploadSample({
      guildId: 'guild-a',
      userId: '1234567890',
      displayName: 'เจ้าของ',
      filename: 'sample.wav',
      wavBuffer: wav,
    });
    assert.equal(capturedUrl, 'http://127.0.0.1:8766/v1/samples');
    const headers = new Headers(capturedInit?.headers);
    assert.equal(headers.get('authorization'), 'Bearer test-token-with-at-least-24-characters');
    assert.equal(headers.get('content-type'), 'audio/wav');
    assert.equal(headers.get('x-discord-user-id'), '1234567890');
    assert.deepEqual(capturedInit?.body, wav);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('VOICE_SERVICE_URL', previousUrl);
    restoreEnvironment('VOICE_API_TOKEN', previousToken);
  }
});

test('voice training sends the selected mode, checkpoint, and epoch count', async () => {
  const previousUrl = process.env.VOICE_SERVICE_URL;
  const previousToken = process.env.VOICE_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.VOICE_SERVICE_URL = 'http://127.0.0.1:8766';
  process.env.VOICE_API_TOKEN = 'test-token-with-at-least-24-characters';
  let requestBody: any;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      speakerId: '1234567890',
      sampleCount: 12,
      durationSeconds: 180,
      modelReady: true,
      job: { id: 'job-test', status: 'queued' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    await new VoiceServiceClient().startTraining('1234567890', 'Gam', {
      trainingMode: 'finetune',
      modelSelection: 'latest',
      epochs: 45,
    });
    assert.deepEqual(requestBody, {
      speakerId: '1234567890',
      displayName: 'Gam',
      trainingMode: 'finetune',
      modelSelection: 'latest',
      epochs: 45,
    });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('VOICE_SERVICE_URL', previousUrl);
    restoreEnvironment('VOICE_API_TOKEN', previousToken);
  }
});

test('voice training can request a safe stop after the current epoch', async () => {
  const previousUrl = process.env.VOICE_SERVICE_URL;
  const previousToken = process.env.VOICE_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.VOICE_SERVICE_URL = 'http://127.0.0.1:8766';
  process.env.VOICE_API_TOKEN = 'test-token-with-at-least-24-characters';
  let capturedUrl = '';
  let requestBody: any;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      speakerId: '1234567890', sampleCount: 12, durationSeconds: 180, modelReady: true,
      job: { id: 'job-test', status: 'stopping', currentEpoch: 8, stopAfterEpoch: 9, stopRequested: true },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const status = await new VoiceServiceClient().stopTrainingAfterCurrentEpoch('1234567890');
    assert.equal(capturedUrl, 'http://127.0.0.1:8766/v1/train/stop');
    assert.deepEqual(requestBody, { speakerId: '1234567890' });
    assert.equal(status.job?.status, 'stopping');
    assert.equal(status.job?.stopAfterEpoch, 9);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('VOICE_SERVICE_URL', previousUrl);
    restoreEnvironment('VOICE_API_TOKEN', previousToken);
  }
});

test('voice playback can select Best or Latest as the active model', async () => {
  const previousUrl = process.env.VOICE_SERVICE_URL;
  const previousToken = process.env.VOICE_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.VOICE_SERVICE_URL = 'http://127.0.0.1:8766';
  process.env.VOICE_API_TOKEN = 'test-token-with-at-least-24-characters';
  let capturedUrl = '';
  let requestBody: any;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      speakerId: '1234567890', sampleCount: 12, durationSeconds: 180, modelReady: true,
      checkpointSelection: { active: 'latest', bestEpoch: 11, latestEpoch: 114 },
      availableModels: { best: true, latest: true },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const status = await new VoiceServiceClient().selectActiveModel('1234567890', 'latest');
    assert.equal(capturedUrl, 'http://127.0.0.1:8766/v1/models/select');
    assert.deepEqual(requestBody, { speakerId: '1234567890', modelSelection: 'latest' });
    assert.equal(status.checkpointSelection?.active, 'latest');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('VOICE_SERVICE_URL', previousUrl);
    restoreEnvironment('VOICE_API_TOKEN', previousToken);
  }
});

test('voice cloud export preview sends selected contents and cleanup settings', async () => {
  const previousUrl = process.env.VOICE_SERVICE_URL;
  const previousToken = process.env.VOICE_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.VOICE_SERVICE_URL = 'http://127.0.0.1:8766';
  process.env.VOICE_API_TOKEN = 'test-token-with-at-least-24-characters';
  let capturedUrl = '';
  let requestBody: any;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      ready: true,
      blockers: [],
      warnings: [],
      recommendations: [],
      summary: { speakerId: '1234567890', sampleCount: 12, durationSeconds: 180, transcriptCount: 12 },
      options: requestBody,
      commandScript: 'RUN_FINETUNE_BEST_30_EPOCHS.sh',
      command: 'bash RUN_FINETUNE_BEST_30_EPOCHS.sh',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  try {
    const options = {
      trainingTarget: 'vast_24gb' as const,
      trainingMode: 'finetune' as const,
      modelSelection: 'best' as const,
      epochs: 30,
      includeDataset: true,
      includeTranscripts: true,
      includeBestModel: true,
      includeLatestModel: false,
      includeTrainingLogs: true,
      includeTrainer: true,
      cleanAudio: true,
      excludeLowQuality: true,
    };
    await new VoiceServiceClient().previewTrainingExport('1234567890', options);
    assert.equal(capturedUrl, 'http://127.0.0.1:8766/v1/exports/preview');
    assert.deepEqual(requestBody, { speakerId: '1234567890', ...options });
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('VOICE_SERVICE_URL', previousUrl);
    restoreEnvironment('VOICE_API_TOKEN', previousToken);
  }
});

test('local cloned TTS uses the selected Discord user model, turn ID, and auth token', async () => {
  const previousUrl = process.env.VOICE_SERVICE_URL;
  const previousToken = process.env.VOICE_API_TOKEN;
  const originalFetch = globalThis.fetch;
  process.env.VOICE_SERVICE_URL = 'http://127.0.0.1:8766';
  process.env.VOICE_API_TOKEN = 'test-token-with-at-least-24-characters';
  let requestBody: any;
  let requestHeaders: Headers | undefined;
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    requestHeaders = new Headers(init?.headers);
    return new Response(Buffer.from('wav-output'), { status: 200, headers: { 'Content-Type': 'audio/wav' } });
  }) as typeof fetch;

  try {
    const result = await new LocalTTSProvider().synthesize('ทดสอบ', '1234567890', {
      tone: 'curious', action: 'ANSWER', modelSelection: 'latest', turnId: 'turn_test_123',
    });
    assert.deepEqual(result, Buffer.from('wav-output'));
    assert.equal(requestBody.speakerId, '1234567890');
    assert.equal(requestBody.tone, 'curious');
    assert.equal(requestBody.action, 'ANSWER');
    assert.equal(requestBody.modelSelection, 'latest');
    assert.equal(requestBody.turnId, 'turn_test_123');
    assert.equal(requestHeaders?.get('authorization'), 'Bearer test-token-with-at-least-24-characters');
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnvironment('VOICE_SERVICE_URL', previousUrl);
    restoreEnvironment('VOICE_API_TOKEN', previousToken);
  }
});

test('TTS pronunciation replacements escape punctuation and respect ASCII token boundaries', () => {
  const provider = new LocalTTSProvider('http://127.0.0.1:1');
  (provider as unknown as { dict: Record<string, string> }).dict = {
    'C++': 'cplusplus',
    AI: 'ay-eye',
  };
  assert.equal(provider.preprocessText('C++ AI SAINT'), 'cplusplus ay-eye SAINT');
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
  let synthesizedTurnId = '';
  let cancelledTurnId = '';
  const ttsProvider: TTSProvider = {
    synthesize: (_text, _speaker, prosody) => new Promise<Buffer>(resolve => {
      synthesizedTurnId = prosody?.turnId || '';
      releaseSynthesis = resolve;
    }),
    cancel: turnId => { cancelledTurnId = turnId; },
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
  assert.equal(manager.getCurrentPhase(), 'synthesizing');
  manager.cancelCurrentTurn('guild');
  assert.match(synthesizedTurnId, /^turn_/);
  assert.equal(cancelledTurnId, synthesizedTurnId);
  assert.ok(releaseSynthesis);
  releaseSynthesis(Buffer.from('audio'));

  assert.equal(await turn, false);
  assert.equal(playbackCalls, 0);
  assert.equal(manager.isTurnActive('guild'), false);
});

test('barge-in detector ignores short noise but confirms sustained voice', () => {
  const detector = new SustainedVoiceDetector({ minimumVoicedMs: 300, minimumRmsDbfs: -42 });
  const quietFrame = Buffer.alloc(48_000 * 2 * 2 * 0.1);
  assert.equal(detector.observePcm(quietFrame).confirmed, false);

  const voicedFrame = Buffer.alloc(48_000 * 2 * 2 * 0.1);
  for (let offset = 0; offset < voicedFrame.length; offset += 2) voicedFrame.writeInt16LE(8_000, offset);
  assert.equal(detector.observePcm(voicedFrame).confirmed, false);
  assert.equal(detector.observePcm(voicedFrame).confirmed, false);
  assert.equal(detector.observePcm(voicedFrame).confirmed, true);
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

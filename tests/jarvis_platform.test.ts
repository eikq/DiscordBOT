import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConversationTimeline } from '../src/bot/timeline/ConversationTimeline';
import { GroupConversationState } from '../src/bot/brain/GroupConversationState';
import { SocialDecision } from '../src/bot/brain/types';
import { BehaviorRetriever } from '../src/bot/personality/BehaviorRetriever';
import type { PersonaProfile } from '../src/bot/personality/PersonaProfileManager';
import { ResponseGenerator } from '../src/bot/personality/ResponseGenerator';
import type { LocalLlmProvider } from '../src/bot/llm/LocalLlmProvider';
import {
  FactPreservingPresentationEngine,
  JARVIS_BRAIN_ID,
  JARVIS_PERSONA_ID,
  JARVIS_VOICE_ID,
  JarvisCoreResult,
  JarvisRequest,
  LEGACY_DISCORD_COUPLING,
  PassThroughJarvisCore,
  PresentationProfile,
  ResponseGeneratorPresentationEngine,
  UnavailableJarvisCore,
  applySessionUpdate,
  createPresentationSession,
  defaultJarvisPresentation,
  immutableFacts,
  legacyPersonaCommandProfile,
  legacyVoiceCommandProfile,
  memoryDomainsFor,
  memoryScopePersonaId,
  presentationContradictsFacts,
  resolveTurnProfile,
  withPersona,
  withVoice,
} from '../src/jarvis';

function weatherResult(requestId: string): JarvisCoreResult {
  return {
    requestId,
    answerIntent: 'weather',
    verifiedFacts: [{
      key: 'temperature_c',
      value: 31,
      sourceType: 'tool',
      sourceRef: 'weather',
      confidence: 0.9,
      immutableForPresentation: true,
    }],
    unverifiedClaims: [],
    toolResults: [{ toolName: 'weather', status: 'ok' }],
    memoryRefs: [{ canonicalId: 'fact:weather-today', domain: 'global' }],
    actionResults: [],
    uncertainty: [],
    suggestedContent: 'วันนี้ร้อน 31 องศา',
  };
}

function requestWith(profile: PresentationProfile, text = 'วันนี้อากาศเป็นไง'): JarvisRequest {
  return {
    requestId: 'req-weather',
    source: 'discord',
    input: { text },
    clientContext: { sessionId: 'guild-1', guildId: 'g1' },
    presentation: profile,
    capabilities: ['weather'],
  };
}

function assertPresentationNeutral(result: JarvisCoreResult) {
  assert.ok(!('personaProfileId' in result));
  assert.ok(!('voiceProfileId' in result));
  assert.ok(Array.isArray(result.verifiedFacts));
  assert.ok(Array.isArray(result.toolResults));
  assert.ok(Array.isArray(result.memoryRefs));
}

test('Jarvis Core is presentation-neutral and can carry facts, tool refs, and memory refs', async () => {
  const core = new PassThroughJarvisCore(() => weatherResult('ignored'));
  const styledRequest = requestWith(withPersona(withVoice(defaultJarvisPresentation(), 'gam-user'), 'gam-user', 'SOCIAL'));
  const result = await core.handle(styledRequest);
  assert.equal(result.requestId, 'req-weather');
  assertPresentationNeutral(result);
  assert.equal(immutableFacts(result).length, 1);
  assert.equal(result.toolResults[0]?.toolName, 'weather');
  assert.equal(result.memoryRefs[0]?.canonicalId, 'fact:weather-today');
});

test('UnavailableJarvisCore is honest that the live Discord path is not wired', async () => {
  const result = await new UnavailableJarvisCore().handle(requestWith(defaultJarvisPresentation()));
  assert.equal(result.answerIntent, 'unavailable');
  assert.match(result.uncertainty[0] || '', /not wired/u);
  assertPresentationNeutral(result);
});

test('brain, persona, and voice are independent fields on PresentationProfile', () => {
  const base = defaultJarvisPresentation();
  const voiceOnly = withVoice(base, 'gam-user');
  const personaOnly = withPersona(base, 'gam-user');
  assert.equal(base.brainProfileId, JARVIS_BRAIN_ID);
  assert.equal(voiceOnly.voiceProfileId, 'gam-user');
  assert.equal(voiceOnly.personaProfileId, JARVIS_PERSONA_ID);
  assert.equal(voiceOnly.personaMode, 'NONE');
  assert.equal(personaOnly.personaProfileId, 'gam-user');
  assert.equal(personaOnly.voiceProfileId, JARVIS_VOICE_ID);
  assert.notEqual(voiceOnly.voiceProfileId, personaOnly.voiceProfileId);
});

test('scenario matrix keeps brain=jarvis while persona and voice vary', () => {
  const scenarios: Array<{ name: string; persona: string; voice: string }> = [
    { name: 'default Jarvis', persona: JARVIS_PERSONA_ID, voice: JARVIS_VOICE_ID },
    { name: 'Gam full', persona: 'gam-user', voice: 'gam-user' },
    { name: 'Gam voice only', persona: JARVIS_PERSONA_ID, voice: 'gam-user' },
    { name: 'Gam persona only', persona: 'gam-user', voice: JARVIS_VOICE_ID },
    { name: 'Elemisu voice only', persona: JARVIS_PERSONA_ID, voice: 'elemisu-user' },
    { name: 'mixed Gam persona + Elemisu voice', persona: 'gam-user', voice: 'elemisu-user' },
  ];
  for (const scenario of scenarios) {
    const profile = withVoice(
      withPersona(defaultJarvisPresentation(), scenario.persona, scenario.persona === JARVIS_PERSONA_ID ? 'NONE' : 'STYLE'),
      scenario.voice,
    );
    assert.equal(profile.brainProfileId, JARVIS_BRAIN_ID, scenario.name);
    assert.equal(profile.personaProfileId, scenario.persona, scenario.name);
    assert.equal(profile.voiceProfileId, scenario.voice, scenario.name);
  }
});

test('legacy /voice and /persona mapping still couple persona and voice', () => {
  const userId = '897089867752808479';
  const voice = legacyVoiceCommandProfile(userId);
  const persona = legacyPersonaCommandProfile(userId);
  assert.deepEqual(voice, persona);
  assert.equal(voice.brainProfileId, JARVIS_BRAIN_ID);
  assert.equal(voice.personaProfileId, userId);
  assert.equal(voice.voiceProfileId, userId);
  assert.equal(voice.personaMode, 'SOCIAL');
  assert.deepEqual(LEGACY_DISCORD_COUPLING.commandsThatSetBoth, ['/voice', '/persona']);
});

test('voice-only selection does not load persona memory', () => {
  const profile = withVoice(defaultJarvisPresentation(), 'gam-user');
  assert.equal(memoryScopePersonaId(profile), undefined);
  assert.deepEqual(memoryDomainsFor(profile), ['global', 'discord']);
  assert.equal(profile.personaMode, 'NONE');
});

test('persona-only selection does not change voice and does not load a voice model', async () => {
  let voiceLoads = 0;
  const resolver = {
    resolve: async (profileId: string) => {
      voiceLoads += 1;
      return { profileId, available: true };
    },
  };
  const profile = withPersona(defaultJarvisPresentation(), 'gam-user', 'STYLE');
  assert.equal(profile.voiceProfileId, JARVIS_VOICE_ID);
  assert.equal(memoryScopePersonaId(profile), 'gam-user');
  assert.deepEqual(memoryDomainsFor(profile), ['global', 'discord', 'persona']);
  assert.equal(voiceLoads, 0);
  await resolver.resolve(profile.voiceProfileId);
  assert.equal(voiceLoads, 1);
});

test('one-turn override does not persist on the session profile', () => {
  const session = createPresentationSession('guild-1', withVoice(defaultJarvisPresentation(), 'gam-user'));
  const turn = resolveTurnProfile(session, { personaProfileId: 'gam-user', personaMode: 'STYLE' });
  assert.equal(turn.personaProfileId, 'gam-user');
  assert.equal(turn.voiceProfileId, 'gam-user');
  assert.equal(session.activeProfile.personaProfileId, JARVIS_PERSONA_ID);
  const next = applySessionUpdate(session, { personaProfileId: 'gam-user', personaMode: 'STYLE' });
  assert.equal(next.activeProfile.personaProfileId, 'gam-user');
  assert.equal(session.activeProfile.personaProfileId, JARVIS_PERSONA_ID);
});

test('persona styling cannot drop immutable verified facts and does not call tools', async () => {
  const result = weatherResult('req-weather');
  const engine = new FactPreservingPresentationEngine();
  const presented = await engine.render(
    result,
    withPersona(defaultJarvisPresentation(), 'gam-user', 'STYLE'),
    { sessionId: 'guild-1' },
  );
  assert.match(presented.text, /31/u);
  assert.equal(presented.personaProfileId, 'gam-user');
  assert.equal(presented.voiceProfileId, JARVIS_VOICE_ID);
  assert.equal(presented.behaviorPersonaId, 'gam-user');
  assert.deepEqual(presentationContradictsFacts('วันนี้ไม่มีฝน', result), ['missing immutable fact temperature_c=31']);
  assert.deepEqual(presentationContradictsFacts(presented.text, result), []);
  assert.equal(result.toolResults[0]?.toolName, 'weather');
});

const GAM_PERSONA: PersonaProfile = {
  userId: '897089867752808479',
  displayName: 'Gam',
  aliases: ['Gam', 'แก้ม'],
  description: '',
  updatedAt: 0,
};

const ANSWER_DECISION: SocialDecision = {
  action: 'ANSWER',
  targetUserIds: ['Bank'],
  confidence: 1,
  directlyAddressed: true,
  responseExpected: 1,
  interruptAppropriate: false,
  desiredLength: 'very_short',
  tone: 'casual',
  reasonCode: 'TEST',
};

function conversationState(text: string): GroupConversationState {
  const timeline = new ConversationTimeline();
  timeline.addEvent({
    type: 'VOICE_SESSION_STARTED',
    sessionId: 'test-session',
    guildId: 'test-guild',
    channelId: 'test-channel',
    timestamp: 0,
  });
  timeline.addEvent({
    type: 'TRANSCRIPT_FINAL',
    eventId: 'event-0',
    sessionId: 'test-session',
    discordUserId: 'Bank',
    username: 'Bank',
    displayName: 'Bank',
    rawText: text,
    confidence: 0.99,
    timestamp: 1000,
    speechStartedAt: 900,
    speechEndedAt: 1000,
    sttLatencyMs: 10,
  });
  return new GroupConversationState(timeline);
}

function throwingLlm(): LocalLlmProvider {
  return {
    generateText: async () => {
      throw new Error('LLM must not be called for this presentation test');
    },
  } as unknown as LocalLlmProvider;
}

test('legacy presentLegacyTurn matches ResponseGenerator when no independent profile is supplied', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-presentation-'));
  try {
    const examplesPath = path.join(tempDir, 'examples.json');
    fs.writeFileSync(examplesPath, JSON.stringify([{
      conversationId: 'gam',
      context: [{ speaker: 'Bank', text: 'banana-split-xyz ไปไหม' }],
      ownerAction: 'ANSWER',
      ownerResponse: 'ไปดิแก้ม',
      responseDelayMs: 1,
      relationship: 'friend',
      directlyAddressed: true,
      topic: 'gaming',
      personaUserId: GAM_PERSONA.userId,
    }]));
    const generator = new ResponseGenerator({
      retriever: new BehaviorRetriever(examplesPath),
      localLlm: throwingLlm(),
    });
    const engine = new ResponseGeneratorPresentationEngine(generator);
    const state = conversationState('banana-split-xyz ไปไหม');
    const direct = await generator.generate(ANSWER_DECISION, state, GAM_PERSONA);
    const presented = await engine.presentLegacyTurn({
      sessionId: 'guild-1',
      decision: ANSWER_DECISION,
      state,
      persona: GAM_PERSONA,
    });
    assert.equal(direct, 'ไปดิแก้ม');
    assert.equal(presented?.text, direct);
    assert.equal(presented?.personaProfileId, GAM_PERSONA.userId);
    assert.equal(presented?.voiceProfileId, GAM_PERSONA.userId);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('voice-only profile does not load persona behavior examples', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-presentation-voice-'));
  try {
    const examplesPath = path.join(tempDir, 'examples.json');
    fs.writeFileSync(examplesPath, JSON.stringify([{
      conversationId: 'gam',
      context: [{ speaker: 'Bank', text: 'banana-split-xyz ไปไหม' }],
      ownerAction: 'ANSWER',
      ownerResponse: 'ไปดิแก้ม',
      responseDelayMs: 1,
      relationship: 'friend',
      directlyAddressed: true,
      topic: 'gaming',
      personaUserId: GAM_PERSONA.userId,
    }]));
    let systemPrompt = '';
    const engine = new ResponseGeneratorPresentationEngine(new ResponseGenerator({
      retriever: new BehaviorRetriever(examplesPath),
      localLlm: {
        generateText: async (request: { systemPrompt?: string }) => {
          systemPrompt = request.systemPrompt || '';
          return 'ยังไม่รู้ว่ะ มึงว่าไง';
        },
      } as unknown as LocalLlmProvider,
    }));
    const presented = await engine.presentLegacyTurn({
      sessionId: 'guild-1',
      decision: ANSWER_DECISION,
      state: conversationState('banana-split-xyz ไปไหม'),
      persona: GAM_PERSONA,
      profile: withVoice(defaultJarvisPresentation(), GAM_PERSONA.userId),
    });
    assert.notEqual(presented?.text, 'ไปดิแก้ม');
    assert.equal(presented?.text, 'ยังไม่รู้ว่ะ มึงว่าไง');
    assert.match(systemPrompt, /คุณคือ Spin/u);
    assert.equal(presented?.personaProfileId, JARVIS_PERSONA_ID);
    assert.equal(presented?.voiceProfileId, GAM_PERSONA.userId);
    assert.equal(presented?.behaviorPersonaId, undefined);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('structured Core facts skip ResponseGenerator and do not load a voice model', async () => {
  let generateCalls = 0;
  let voiceLoads = 0;
  const generator = {
    generate: async () => {
      generateCalls += 1;
      return 'วันนี้ไม่มีฝน';
    },
  } as unknown as ResponseGenerator;
  const engine = new ResponseGeneratorPresentationEngine(generator);
  const presented = await engine.presentLegacyTurn({
    sessionId: 'guild-1',
    decision: ANSWER_DECISION,
    state: conversationState('วันนี้อากาศเป็นไง'),
    persona: GAM_PERSONA,
    profile: withPersona(defaultJarvisPresentation(), GAM_PERSONA.userId, 'STYLE'),
    result: weatherResult('req-weather'),
  });
  assert.equal(generateCalls, 0);
  assert.equal(voiceLoads, 0);
  assert.match(presented?.text || '', /31/u);
  assert.equal(presented?.personaProfileId, GAM_PERSONA.userId);
  assert.equal(presented?.voiceProfileId, JARVIS_VOICE_ID);
  assert.ok(presented?.transformations.includes('structured-facts-skip-legacy-generate'));
});

test('PresentationEngine.render does not call ResponseGenerator', async () => {
  let generateCalls = 0;
  const generator = {
    generate: async () => {
      generateCalls += 1;
      return 'nope';
    },
  } as unknown as ResponseGenerator;
  const engine = new ResponseGeneratorPresentationEngine(generator);
  const presented = await engine.render(
    weatherResult('req-weather'),
    defaultJarvisPresentation(),
    { sessionId: 'guild-1' },
  );
  assert.equal(generateCalls, 0);
  assert.match(presented.text, /31/u);
});

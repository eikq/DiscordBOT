import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FactPreservingPresentationEngine,
  FileBehaviorPersonaProvider,
  GAM_PERSONA_ID,
  GAM_VOICE_ID,
  JARVIS_BRAIN_ID,
  JARVIS_PERSONA_ID,
  JARVIS_VOICE_ID,
  LocalLlmJarvisCore,
  PassThroughJarvisCore,
  StandalonePresentationSessions,
  defaultJarvisPresentation,
  withPersona,
  withVoice,
} from '../src/jarvis';
import type { JarvisCoreResult } from '../src/jarvis';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';

function tempExamples(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-persona-'));
  const file = path.join(root, 'examples.json');
  fs.writeFileSync(file, JSON.stringify([
    {
      conversationId: 'gam-1',
      context: [{ speaker: 'Bank', text: 'เล่นปะ' }],
      ownerAction: 'ANSWER',
      ownerResponse: 'เอาดิ',
      responseDelayMs: 1,
      relationship: 'friend',
      directlyAddressed: true,
      topic: 'gaming',
      personaUserId: 'gam',
    },
    {
      conversationId: 'other-1',
      context: [{ speaker: 'Bank', text: 'เล่นปะ' }],
      ownerAction: 'ANSWER',
      ownerResponse: 'secret-other',
      responseDelayMs: 1,
      relationship: 'friend',
      directlyAddressed: true,
      topic: 'gaming',
      personaUserId: 'other',
    },
  ]));
  return file;
}

function factResult(requestId: string): JarvisCoreResult {
  return {
    requestId,
    answerIntent: 'weather',
    verifiedFacts: [{
      key: 'temperature_c',
      value: '31',
      sourceType: 'tool',
      sourceRef: 'weather',
      confidence: 0.9,
      immutableForPresentation: true,
    }],
    unverifiedClaims: [],
    toolResults: [{ toolName: 'weather', status: 'ok' }],
    memoryRefs: [{ canonicalId: 'fact:weather-today', domain: 'global' }],
    actionResults: [],
    uncertainty: ['tool evidence only'],
    suggestedContent: 'ร้อน',
  };
}

const silentVoice = {
  resolve: async (profileId: string) => ({
    profileId,
    selected: true,
    available: false,
    speechActive: false,
    reason: 'Speech runtime is not running; voice is selected but not active for speech.',
  }),
};

test('Jarvis and Gam persona/voice combinations stay independent', () => {
  const sessions = new StandalonePresentationSessions();
  const matrix = [
    { persona: JARVIS_PERSONA_ID, voice: JARVIS_VOICE_ID },
    { persona: GAM_PERSONA_ID, voice: GAM_VOICE_ID },
    { persona: JARVIS_PERSONA_ID, voice: GAM_VOICE_ID },
    { persona: GAM_PERSONA_ID, voice: JARVIS_VOICE_ID },
  ];
  for (const row of matrix) {
    sessions.selectPersona('lab', row.persona);
    sessions.selectVoice('lab', row.voice);
    const profile = sessions.resolveTurn('lab');
    assert.equal(profile.brainProfileId, JARVIS_BRAIN_ID, `${row.persona}+${row.voice}`);
    assert.equal(profile.personaProfileId, row.persona, `${row.persona}+${row.voice}`);
    assert.equal(profile.voiceProfileId, row.voice, `${row.persona}+${row.voice}`);
  }
});

test('persona switch does not mutate voice and voice switch does not mutate persona', () => {
  const sessions = new StandalonePresentationSessions();
  sessions.selectVoice('lab', GAM_VOICE_ID);
  sessions.selectPersona('lab', GAM_PERSONA_ID);
  assert.equal(sessions.get('lab').activeProfile.voiceProfileId, GAM_VOICE_ID);
  sessions.selectPersona('lab', JARVIS_PERSONA_ID);
  assert.equal(sessions.get('lab').activeProfile.voiceProfileId, GAM_VOICE_ID);
  assert.equal(sessions.get('lab').activeProfile.personaProfileId, JARVIS_PERSONA_ID);
  sessions.selectVoice('lab', JARVIS_VOICE_ID);
  assert.equal(sessions.get('lab').activeProfile.personaProfileId, JARVIS_PERSONA_ID);
  assert.equal(sessions.get('lab').activeProfile.voiceProfileId, JARVIS_VOICE_ID);
});

test('one-turn override expires after one turn while session override persists', () => {
  const sessions = new StandalonePresentationSessions();
  sessions.selectVoice('lab', GAM_VOICE_ID);
  const turn = sessions.resolveTurn('lab', { personaProfileId: GAM_PERSONA_ID, personaMode: 'STYLE' });
  assert.equal(turn.personaProfileId, GAM_PERSONA_ID);
  assert.equal(turn.voiceProfileId, GAM_VOICE_ID);
  const after = sessions.get('lab');
  assert.equal(after.activeProfile.personaProfileId, JARVIS_PERSONA_ID);
  assert.equal(after.activeProfile.voiceProfileId, GAM_VOICE_ID);
  sessions.selectPersona('lab', GAM_PERSONA_ID);
  assert.equal(sessions.get('lab').activeProfile.personaProfileId, GAM_PERSONA_ID);
  assert.equal(sessions.resolveTurn('lab').personaProfileId, GAM_PERSONA_ID);
});

test('persona rendering preserves immutable facts, memory ids, tools, and uncertainty', async () => {
  const examples = tempExamples();
  const engine = new FactPreservingPresentationEngine({
    persona: new FileBehaviorPersonaProvider({ [GAM_PERSONA_ID]: 'gam' }, examples),
    voices: silentVoice,
  });
  const coreResult = factResult('req-imm');
  const presented = await engine.render(
    coreResult,
    withVoice(withPersona(defaultJarvisPresentation(), GAM_PERSONA_ID, 'STYLE'), JARVIS_VOICE_ID),
    { sessionId: 'lab' },
  );
  assert.match(presented.text, /31/u);
  assert.match(presented.text, /แบบนี้ไง/u);
  assert.equal(presented.personaProfileId, GAM_PERSONA_ID);
  assert.equal(presented.voiceProfileId, JARVIS_VOICE_ID);
  assert.equal(coreResult.memoryRefs[0]?.canonicalId, 'fact:weather-today');
  assert.equal(coreResult.toolResults[0]?.status, 'ok');
  assert.deepEqual(coreResult.uncertainty, ['tool evidence only']);
  assert.ok(presented.transformations.some(item => item.includes('examples:1')));
  assert.ok(presented.transformations.some(item => item.includes('speech-inactive')));
});

test('selecting a persona loads only that persona scoped examples', async () => {
  const examples = tempExamples();
  const persona = new FileBehaviorPersonaProvider({ [GAM_PERSONA_ID]: 'gam' }, examples);
  const gam = await persona.getBehaviorExamples(GAM_PERSONA_ID, 'เล่นปะ', 3);
  const jarvis = await persona.getBehaviorExamples(JARVIS_PERSONA_ID, 'เล่นปะ', 3);
  assert.equal(gam.length, 1);
  assert.equal(gam[0]?.id, 'gam-1');
  assert.equal(jarvis.length, 0);
});

test('lab runtime one-turn persona does not persist and does not call Discord', async () => {
  const examples = tempExamples();
  const lab = createJarvisLabRuntime({
    attachDefaultMemory: false,
    attachDefaultCapabilities: false,
    attachDefaultPresentation: false,
    core: new LocalLlmJarvisCore({ generateText: async () => 'hello from core' }),
    llm: {
      generateText: async () => 'hello from core',
      getRuntimeStatus: async () => ({ enabled: true, reachable: false, model: 'test' }),
    },
    persona: new FileBehaviorPersonaProvider({ [GAM_PERSONA_ID]: 'gam' }, examples),
    voices: silentVoice,
  });
  lab.selectVoice('jarvis-lab', GAM_VOICE_ID);
  const asked = await lab.ask({
    text: 'hello',
    personaProfileId: GAM_PERSONA_ID,
    voiceProfileId: JARVIS_VOICE_ID,
    oneTurn: true,
  });
  assert.equal(asked.presented.personaProfileId, GAM_PERSONA_ID);
  assert.equal(asked.presented.voiceProfileId, JARVIS_VOICE_ID);
  const session = await lab.presentationStatus('jarvis-lab');
  assert.equal(session.persona.id, JARVIS_PERSONA_ID);
  assert.equal(session.voice.profileId, GAM_VOICE_ID);
  assert.equal(session.voice.speechActive, false);
  assert.equal(session.brain.id, JARVIS_BRAIN_ID);
  assert.equal(session.voice.selected, true);
});

test('lab runtime session persona/voice persist independently', async () => {
  const lab = createJarvisLabRuntime({
    attachDefaultMemory: false,
    core: new PassThroughJarvisCore(() => factResult('sess')),
    voices: silentVoice,
  });
  lab.selectPersona('jarvis-lab', GAM_PERSONA_ID);
  let state = await lab.presentationStatus('jarvis-lab');
  assert.equal(state.persona.id, GAM_PERSONA_ID);
  assert.equal(state.voice.profileId, JARVIS_VOICE_ID);
  lab.selectVoice('jarvis-lab', GAM_VOICE_ID);
  state = await lab.presentationStatus('jarvis-lab');
  assert.equal(state.persona.id, GAM_PERSONA_ID);
  assert.equal(state.voice.profileId, GAM_VOICE_ID);
  const asked = await lab.ask({ text: 'อากาศ' });
  assert.equal(asked.presented.personaProfileId, GAM_PERSONA_ID);
  assert.equal(asked.presented.voiceProfileId, GAM_VOICE_ID);
  assert.match(asked.presented.text, /31/u);
});

test('standalone presentation modules do not import Discord or RVC clients', () => {
  const discord = /from\s+['"](?:discord(?:\.js)?|@discordjs\/)['"]/u;
  const rvc = /VoiceServiceClient|local_voice_process/u;
  const files = [
    path.join(process.cwd(), 'src', 'jarvis', 'presentation', 'standaloneSession.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'presentation', 'filePersonaProvider.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'presentation', 'PresentationEngine.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'presentation', 'voiceAvailability.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'JarvisLabPage.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'JarvisCoreVisual.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'labUiState.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'browserMicrophone.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'audio', 'SpeechTurnController.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'audio', 'transcribeUtterance.ts'),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(discord.test(source), false, file);
    assert.equal(rvc.test(source), false, file);
  }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  FactPreservingPresentationEngine,
  JARVIS_PERSONA_ID,
  JARVIS_VOICE_ID,
  LocalLlmJarvisCore,
  PassThroughJarvisCore,
  createJarvisRequest,
  defaultJarvisPresentation,
  immutableFacts,
  memoryScopePersonaId,
  runStandaloneTextTurn,
  standalonePresentation,
  withPersona,
  withVoice,
} from '../src/jarvis';

const DISCORD_TRANSPORT = /(?:^|\n)import[\s\S]*?from\s+['"](?:discord(?:\.js)?|@discordjs\/|[^'"]*BotService|[^'"]*AudioReceiver)['"]/u;

function walkTsFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkTsFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

test('Jarvis core and standalone modules do not import Discord transport', () => {
  const roots = [
    path.join(process.cwd(), 'src', 'jarvis', 'core'),
    path.join(process.cwd(), 'src', 'jarvis', 'standalone'),
    path.join(process.cwd(), 'src', 'jarvis', 'memory'),
    path.join(process.cwd(), 'src', 'jarvis', 'audio'),
    path.join(process.cwd(), 'src', 'jarvis', 'skills'),
  ];
  for (const root of roots) {
    for (const file of walkTsFiles(root)) {
      const source = fs.readFileSync(file, 'utf8');
      assert.equal(DISCORD_TRANSPORT.test(source), false, file);
    }
  }
});

test('createJarvisRequest is desktop-first and transport-neutral', () => {
  const request = createJarvisRequest({
    text: '  วันนี้อากาศเป็นไง  ',
    requestId: 'req-1',
    sessionId: 'desk-1',
  });
  assert.equal(request.source, 'desktop');
  assert.equal(request.input.text, 'วันนี้อากาศเป็นไง');
  assert.equal(request.clientContext.sessionId, 'desk-1');
  assert.equal(request.requestId, 'req-1');
  assert.deepEqual(request.capabilities, []);
  assert.ok(!('guildId' in request && typeof (request as { guildId?: unknown }).guildId === 'object'));
});

test('LocalLlmJarvisCore is honest when the LLM is offline', async () => {
  const core = new LocalLlmJarvisCore({
    generateText: async () => null,
  });
  const result = await core.handle(createJarvisRequest({ text: 'hello', requestId: 'req-off' }));
  assert.equal(result.requestId, 'req-off');
  assert.equal(result.answerIntent, 'unavailable');
  assert.equal(result.suggestedContent, '');
  assert.equal(result.toolResults.length, 0);
  assert.match(result.uncertainty[0] || '', /unavailable/u);
});

test('standalone text harness returns structured result and presented text', async () => {
  const core = new LocalLlmJarvisCore({
    generateText: async () => 'วันนี้ยังไม่รู้สภาพอากาศจริง',
  });
  const output = await runStandaloneTextTurn(
    { text: 'วันนี้อากาศเป็นไง', requestId: 'req-text' },
    { core },
  );
  assert.equal(output.request.source, 'desktop');
  assert.equal(output.result.answerIntent, 'standalone_text');
  assert.equal(output.result.suggestedContent, 'วันนี้ยังไม่รู้สภาพอากาศจริง');
  assert.equal(output.presented.text, 'วันนี้ยังไม่รู้สภาพอากาศจริง');
  assert.deepEqual(output.result.toolResults, []);
  assert.deepEqual(output.result.memoryRefs, []);
  assert.equal(output.presented.personaProfileId, JARVIS_PERSONA_ID);
  assert.equal(output.presented.voiceProfileId, JARVIS_VOICE_ID);
});

test('standalone presentation can select voice and persona independently', () => {
  const voiceOnly = standalonePresentation({ text: 'x', voiceProfileId: 'gam-user' });
  const personaOnly = standalonePresentation({ text: 'x', personaProfileId: 'gam-user' });
  assert.equal(voiceOnly.voiceProfileId, 'gam-user');
  assert.equal(voiceOnly.personaProfileId, JARVIS_PERSONA_ID);
  assert.equal(memoryScopePersonaId(voiceOnly), undefined);
  assert.equal(personaOnly.personaProfileId, 'gam-user');
  assert.equal(personaOnly.voiceProfileId, JARVIS_VOICE_ID);
  assert.equal(memoryScopePersonaId(personaOnly), 'gam-user');
});

test('standalone harness preserves immutable facts and does not call tools', async () => {
  const core = new PassThroughJarvisCore(() => ({
    requestId: 'ignored',
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
  }));
  const output = await runStandaloneTextTurn(
    {
      text: 'วันนี้อากาศเป็นไง',
      personaProfileId: 'gam-user',
      voiceProfileId: JARVIS_VOICE_ID,
    },
    { core, engine: new FactPreservingPresentationEngine() },
  );
  assert.match(output.presented.text, /31/u);
  assert.equal(immutableFacts(output.result).length, 1);
  assert.equal(output.result.toolResults[0]?.toolName, 'weather');
  assert.equal(output.presented.personaProfileId, 'gam-user');
  assert.equal(output.presented.voiceProfileId, JARVIS_VOICE_ID);
  assert.deepEqual(output.request.presentation, withVoice(withPersona(defaultJarvisPresentation(), 'gam-user'), JARVIS_VOICE_ID));
});

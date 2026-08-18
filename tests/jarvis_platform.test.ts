import assert from 'node:assert/strict';
import test from 'node:test';
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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConversationTimeline } from '../src/bot/timeline/ConversationTimeline';
import { SocialMemoryBrain } from '../src/bot/memory/SocialMemoryBrain';
import {
  applyForget,
  applySupersession,
  assertCanonicalSchemaSql,
  canSupersede,
  canonicalMemoryId,
  isRetrievable,
  loadCanonicalSchemaSql,
  parseCanonicalMemoryId,
  projectFact,
  projectObservation,
  projectPersonEntity,
  qdrantPayloadFor,
  qdrantPointId,
} from '../src/bot/memory/jarvis';

test('canonical memory ids are typed and parseable', () => {
  const id = canonicalMemoryId('fact', 'session:event:fact:1');
  assert.equal(id, 'fact:session:event:fact:1');
  assert.deepEqual(parseCanonicalMemoryId(id), { kind: 'fact', localId: 'session:event:fact:1' });
  assert.throws(() => canonicalMemoryId('fact', '   '), /non-empty/u);
  assert.throws(() => parseCanonicalMemoryId('not-an-id'), /Invalid canonical memory id/u);
});

test('canonical SQL schema lists required tables and forbids live migration', () => {
  const sql = loadCanonicalSchemaSql();
  const tables = assertCanonicalSchemaSql(sql);
  assert.ok(tables.includes('facts'));
  assert.ok(tables.includes('observations'));
  assert.ok(tables.includes('facts_fts'));
  assert.match(sql, /source_system/u);
  assert.match(sql, /superseded_by/u);
  assert.match(sql, /deletion_policy/u);
});

test('supersession and forgetting keep provenance-compatible statuses', () => {
  const previous = {
    id: 'fact:old',
    factKey: 'preference:valorant',
    polarity: 'positive',
    status: 'active' as const,
    confidence: 0.8,
    supersededBy: undefined as string | undefined,
  };
  const next = { factKey: 'preference:valorant', polarity: 'negative' };
  assert.equal(canSupersede(previous, next), true);
  const superseded = applySupersession(previous, 'fact:new');
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.supersededBy, 'fact:new');
  assert.ok(superseded.confidence < previous.confidence);
  const forgotten = applyForget({
    status: 'active' as const,
    retention: { retentionClass: 'long_lived' as const, deletionPolicy: 'tombstone' as const },
  });
  assert.equal(forgotten.status, 'forgotten');
  assert.equal(isRetrievable({ status: 'forgotten', retention: forgotten.retention }), false);
});

test('Qdrant payloads reference canonical ids and are not a source of truth', () => {
  const entity = projectPersonEntity({
    userId: '123',
    displayNames: ['Gam'],
    aliases: ['แก้ม'],
    utteranceCount: 4,
    firstSeen: 1,
    lastSeen: 2,
    games: {},
    activities: {},
    facts: [],
    style: {
      totalCharacters: 0,
      questionCount: 0,
      thaiCharacterCount: 0,
      englishWordCount: 0,
      informalTerms: {},
      shortReplies: {},
      voiceSampleCount: 0,
      cleanVoiceSeconds: 0,
      pitchMedianHzTotal: 0,
      pitchMedianHzCount: 0,
      pitchRangeHzTotal: 0,
      pitchRangeHzCount: 0,
      speakingRateTotal: 0,
      speakingRateCount: 0,
      averagePauseMsTotal: 0,
      averagePauseMsCount: 0,
      energyVariationDbTotal: 0,
      energyVariationDbCount: 0,
      learnedVoiceStyles: {},
    },
  });
  const payload = qdrantPayloadFor(entity, { personIds: [entity.id], source: 'discord', occurredAt: 2 });
  assert.equal(payload.canonical_id, entity.id);
  assert.equal(qdrantPointId(entity.id), entity.id);
  assert.equal(payload.memory_type, 'entity');
  assert.equal(payload.status, 'active');
});

test('SocialMemoryBrain records can be projected without migrating or deleting existing files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-jarvis-memory-'));
  const brain = new SocialMemoryBrain(root);
  const timeline = new ConversationTimeline();
  const event = {
    type: 'TRANSCRIPT_FINAL' as const,
    eventId: 'evt-1',
    sessionId: 'session-1',
    discordUserId: 'u1',
    username: 'Gam',
    displayName: 'Gam',
    rawText: 'กูชอบเล่น valo',
    confidence: 0.92,
    timestamp: 1_000,
    speechStartedAt: 900,
    speechEndedAt: 1_000,
    sttLatencyMs: 10,
  };
  timeline.addEvent({
    type: 'VOICE_SESSION_STARTED',
    sessionId: 'session-1',
    guildId: 'g1',
    channelId: 'c1',
    timestamp: 0,
  });
  timeline.addEvent(event);
  brain.recordTranscript('g1', event, timeline.getRecentFinalTranscripts(5));

  const snapshot = brain.getSnapshot();
  const person = snapshot.people[0];
  const observation = snapshot.recentObservations[0];
  const projectedPerson = projectPersonEntity(person);
  const projectedObservation = projectObservation(observation);
  const projectedFact = projectFact(person, person.facts[0]);

  assert.equal(projectedPerson.discordUserId, 'u1');
  assert.equal(projectedObservation.kind, 'observation');
  assert.equal(projectedFact.provenance.sourceSystem, 'social_memory_brain');
  assert.equal(projectedFact.polarity, 'positive');
  assert.ok(fs.existsSync(path.join(root, 'brain_state.json')));
  assert.ok(fs.existsSync(path.join(root, 'observations.jsonl')));
  assert.equal(brain.getSnapshot().people[0].facts[0].text, 'กูชอบเล่น valo');
});

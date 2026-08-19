import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { ConversationTimeline } from '../src/bot/timeline/ConversationTimeline';
import { SocialMemoryBrain } from '../src/bot/memory/SocialMemoryBrain';
import {
  JARVIS_MEMORY_SCHEMA_VERSION,
  MemoryConflictError,
  SqliteJarvisMemoryStore,
  canonicalMemoryId,
  defaultRetention,
  loadCanonicalSchemaSql,
} from '../src/bot/memory/jarvis';
import { openMigratedDatabase } from '../src/bot/memory/jarvis/migrate';
import { JarvisMemoryRetrieval } from '../src/jarvis/memory';
import type { EntityRecord, EpisodeRecord, SemanticFactRecord } from '../src/bot/memory/jarvis/types';

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function entity(id: string, name = 'Gam'): EntityRecord {
  const now = 1_000;
  return {
    id: canonicalMemoryId('entity', id),
    kind: 'entity',
    entityType: 'person',
    displayName: name,
    discordUserId: id,
    status: 'active',
    privacyClass: 'private',
    confidence: 1,
    importance: 0.7,
    provenance: {
      sourceSystem: 'test',
      sourceRecordId: id,
      evidenceIds: [],
      firstSeen: now,
      lastConfirmed: now,
      confirmations: 1,
    },
    retention: defaultRetention('long_lived', now),
  };
}

function fact(localId: string, key: string, value: string, subjectId?: string): SemanticFactRecord {
  const now = 2_000;
  return {
    id: canonicalMemoryId('fact', localId),
    kind: 'fact',
    subjectEntityId: subjectId,
    predicate: key,
    objectValue: value,
    factKey: key,
    polarity: 'statement',
    status: 'active',
    privacyClass: 'private',
    confidence: 0.8,
    importance: 0.6,
    provenance: {
      sourceSystem: 'test',
      sourceRecordId: localId,
      evidenceIds: ['obs:1'],
      firstSeen: now,
      lastConfirmed: now,
      confirmations: 1,
    },
    retention: defaultRetention('long_lived', now),
  };
}

function episode(localId: string, summary: string): EpisodeRecord {
  const now = 3_000;
  return {
    id: canonicalMemoryId('episode', localId),
    kind: 'episode',
    occurredAt: now,
    source: 'desktop',
    eventType: 'conversation',
    summary,
    payload: { topic: 'meeting' },
    status: 'active',
    privacyClass: 'private',
    confidence: 0.7,
    importance: 0.5,
    provenance: {
      sourceSystem: 'test',
      sourceRecordId: localId,
      evidenceIds: [],
      firstSeen: now,
      lastConfirmed: now,
      confirmations: 1,
    },
    retention: defaultRetention('short_lived', now),
  };
}

test('fresh database initializes to the current schema version', () => {
  const root = tempRoot('digital-me-sqlite-fresh-');
  const dbPath = path.join(root, 'jarvis.db');
  const store = new SqliteJarvisMemoryStore(dbPath);
  try {
    assert.equal(store.schemaVersion(), JARVIS_MEMORY_SCHEMA_VERSION);
    assert.equal(store.schemaVersion(), 2);
    assert.ok(fs.existsSync(dbPath));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('schema versioning upgrades an existing v1 database without deleting it', () => {
  const root = tempRoot('digital-me-sqlite-upgrade-');
  const dbPath = path.join(root, 'jarvis.db');
  const db = new DatabaseSync(dbPath, { enableForeignKeyConstraints: true });
  db.exec(loadCanonicalSchemaSql());
  db.prepare('INSERT INTO schema_migrations(version, applied_at, description) VALUES (?, ?, ?)').run(
    1,
    Date.now(),
    'manual v1',
  );
  db.close();
  assert.ok(fs.existsSync(dbPath));
  const before = fs.statSync(dbPath).size;
  const store = new SqliteJarvisMemoryStore(dbPath);
  try {
    assert.equal(store.schemaVersion(), 2);
    assert.ok(fs.existsSync(dbPath));
    assert.ok(fs.statSync(dbPath).size >= before);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('entity, alias, fact, episode, provenance, and persistence survive reopen', () => {
  const root = tempRoot('digital-me-sqlite-crud-');
  const dbPath = path.join(root, 'jarvis.db');
  let store = new SqliteJarvisMemoryStore(dbPath);
  const person = store.putEntity(entity('u1'));
  const alias = store.putAlias(person.id, 'แก้ม', 0.9, ['obs:1']);
  const createdFact = store.putFact(fact('meeting-friday', 'meeting_day', 'Friday', person.id));
  const createdEpisode = store.putEpisode(episode('standup', 'standup moved to Friday'));
  const link = store.link(createdFact.id, createdEpisode.id, 'supported_by');
  store.putIdentitySetting('preferred_name', 'Jarvis', 'test');
  store.putFeedback(createdFact.id, 'remember', 'keep this');
  assert.equal(store.listAliases(person.id)[0]?.alias, 'แก้ม');
  assert.equal(store.getFact(createdFact.id)?.provenance.evidenceIds.includes('obs:1'), true);
  assert.equal(link.relation, 'supported_by');
  store.close();

  store = new SqliteJarvisMemoryStore(dbPath);
  try {
    assert.equal(store.getEntity(person.id)?.displayName, 'Gam');
    assert.equal(store.listAliases(person.id).some(item => item.alias === 'แก้ม'), true);
    assert.equal(store.getFact(createdFact.id)?.objectValue, 'Friday');
    assert.equal(store.getEpisode(createdEpisode.id)?.summary, 'standup moved to Friday');
    assert.equal(store.getIdentitySetting('preferred_name')?.settingValue, 'Jarvis');
    assert.equal(store.listLinks(createdFact.id).length, 1);
    assert.equal(alias.entityId, person.id);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate writes are idempotent and contradictions must be superseded', () => {
  const root = tempRoot('digital-me-sqlite-idem-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  try {
    const person = store.putEntity(entity('u1'));
    store.putEntity({ ...person, displayName: 'Gam Gam' });
    assert.equal(store.getEntity(person.id)?.displayName, 'Gam Gam');
    store.putAlias(person.id, 'แก้ม');
    store.putAlias(person.id, 'แก้ม');
    assert.equal(store.listAliases(person.id).length, 1);

    const friday = store.putFact(fact('a', 'meeting_day', 'Friday', person.id));
    const again = store.putFact(fact('a', 'meeting_day', 'Friday', person.id));
    assert.equal(again.id, friday.id);
    assert.ok(again.provenance.confirmations > friday.provenance.confirmations);

    assert.throws(
      () => store.putFact(fact('b', 'meeting_day', 'Saturday', person.id)),
      (error: unknown) => error instanceof MemoryConflictError,
    );

    const superseded = store.supersedeFact(friday.id, fact('b', 'meeting_day', 'Saturday', person.id));
    assert.equal(superseded.previous.status, 'superseded');
    assert.equal(superseded.previous.supersededBy, superseded.next.id);
    assert.equal(superseded.next.objectValue, 'Saturday');
    assert.equal(store.getFact(friday.id)?.id, friday.id);
    assert.equal(store.listFacts({ factKey: 'meeting_day' }).length, 1);
    assert.equal(store.listFacts({ factKey: 'meeting_day', status: ['active', 'superseded'] }).length, 2);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('forgetting and expiration keep rows and hide them from active retrieval', () => {
  const root = tempRoot('digital-me-sqlite-forget-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  try {
    const person = store.putEntity(entity('u1'));
    const created = store.putFact({
      ...fact('temp', 'snack', 'mango', person.id),
      retention: { retentionClass: 'ephemeral', deletionPolicy: 'tombstone', expiresAt: 10 },
    });
    const forgotten = store.forget(created.id);
    assert.equal(forgotten?.status, 'forgotten');
    assert.equal(store.getFact(created.id)?.status, 'forgotten');
    assert.equal(store.listFacts({ factKey: 'snack' }).length, 0);

    const expiring = store.putFact({
      ...fact('exp', 'weather', 'hot', person.id),
      retention: { retentionClass: 'ephemeral', deletionPolicy: 'tombstone', expiresAt: 20 },
    });
    assert.equal(store.expireDue(50), 1);
    assert.equal(store.getFact(expiring.id)?.status, 'expired');
    assert.equal(store.listFacts({ factKey: 'weather' }).length, 0);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('foreign keys reject aliases without an entity', () => {
  const root = tempRoot('digital-me-sqlite-fk-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  try {
    assert.throws(
      () => store.putAlias(canonicalMemoryId('entity', 'missing'), 'ghost'),
      /FOREIGN KEY|constraint/iu,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('opening a store inside data/brain is refused', () => {
  const root = tempRoot('digital-me-brain-guard-');
  const brainDir = path.join(root, 'data', 'brain');
  fs.mkdirSync(brainDir, { recursive: true });
  assert.throws(
    () => openMigratedDatabase(path.join(brainDir, 'jarvis.db')),
    /data\/brain/u,
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test('SocialMemoryBrain JSON/JSONL stay authoritative when dual-writing to a temp SQLite file', () => {
  const root = tempRoot('digital-me-dual-write-');
  const brainRoot = path.join(root, 'brain');
  const dbPath = path.join(root, 'canonical', 'jarvis.db');
  const store = new SqliteJarvisMemoryStore(dbPath);
  const brain = new SocialMemoryBrain(brainRoot, { canonicalStore: store });
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
  const beforeJson = fs.existsSync(path.join(brainRoot, 'observations.jsonl'))
    ? fs.readFileSync(path.join(brainRoot, 'observations.jsonl'), 'utf8')
    : '';
  brain.recordTranscript('g1', event, timeline.getRecentFinalTranscripts(5));
  const jsonl = fs.readFileSync(path.join(brainRoot, 'observations.jsonl'), 'utf8');
  const state = fs.readFileSync(path.join(brainRoot, 'brain_state.json'), 'utf8');
  try {
    assert.ok(jsonl.length > beforeJson.length);
    assert.match(state, /กูชอบเล่น valo/u);
    assert.ok(fs.existsSync(path.join(brainRoot, 'observations.jsonl')));
    assert.equal(brain.getSnapshot().people[0].facts[0].text, 'กูชอบเล่น valo');
    const mirrored = store.listFacts({ query: 'valo' });
    assert.ok(mirrored.some(item => item.objectValue.includes('valo')));
    assert.equal(store.getEntity(canonicalMemoryId('entity', 'u1'))?.displayName, 'Gam');
    assert.ok(!jsonl.includes('SQLite'));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('JF-004 retrieval returns canonical ids and keeps superseded contradictions', () => {
  const root = tempRoot('digital-me-retrieve-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const retrieval = new JarvisMemoryRetrieval(store);
  try {
    const person = store.putEntity(entity('u1'));
    const friday = store.putFact(fact('a', 'meeting_day', 'Friday', person.id));
    store.supersedeFact(friday.id, fact('b', 'meeting_day', 'Saturday', person.id));
    store.putEpisode(episode('note', 'calendar conflict about Saturday'));

    const active = retrieval.retrieve({ factKey: 'meeting_day' });
    assert.equal(active.length, 1);
    assert.equal(active[0]?.canonicalId, canonicalMemoryId('fact', 'b'));
    assert.equal(active[0]?.status, 'active');

    const both = retrieval.retrieve({ factKey: 'meeting_day', includeSuperseded: true });
    assert.equal(both.length, 2);
    assert.ok(both.some(item => item.status === 'superseded' && item.supersededBy === canonicalMemoryId('fact', 'b')));
    assert.ok(both.every(item => item.evidenceIds.length >= 0));

    const byId = retrieval.retrieve({ canonicalId: friday.id });
    assert.equal(byId[0]?.status, 'superseded');

    const lexical = retrieval.retrieve({ kinds: ['episode'], query: 'Saturday' });
    assert.ok(lexical.some(item => item.canonicalId === canonicalMemoryId('episode', 'note')));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

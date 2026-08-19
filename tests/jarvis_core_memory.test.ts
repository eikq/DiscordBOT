import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  FactPreservingPresentationEngine,
  JarvisMemoryRetrieval,
  LocalLlmJarvisCore,
  createJarvisRequest,
  runStandaloneTextTurn,
} from '../src/jarvis';
import { createJarvisLabRuntime } from '../src/jarvis/standalone/labRuntime';
import { SqliteJarvisMemoryStore, canonicalMemoryId, defaultRetention } from '../src/bot/memory/jarvis';
import type { JarvisMemoryStore } from '../src/bot/memory/jarvis/store';
import type { EntityRecord, EpisodeRecord, SemanticFactRecord } from '../src/bot/memory/jarvis/types';

function tempDb(): { root: string; store: SqliteJarvisMemoryStore; retrieval: JarvisMemoryRetrieval } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'digital-me-core-memory-'));
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  return { root, store, retrieval: new JarvisMemoryRetrieval(store) };
}

function entity(id = 'sys'): EntityRecord {
  const now = 1_000;
  return {
    id: canonicalMemoryId('entity', id),
    kind: 'entity',
    entityType: 'other',
    displayName: 'Jarvis',
    status: 'active',
    privacyClass: 'private',
    confidence: 1,
    importance: 0.5,
    provenance: {
      sourceSystem: 'test',
      evidenceIds: ['seed'],
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
    confidence: 0.91,
    importance: 0.8,
    provenance: {
      sourceSystem: 'test',
      sourceRecordId: localId,
      evidenceIds: ['obs:seed'],
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
    eventType: 'note',
    summary,
    payload: {},
    status: 'active',
    privacyClass: 'private',
    confidence: 0.7,
    importance: 0.4,
    provenance: {
      sourceSystem: 'test',
      evidenceIds: ['ep:seed'],
      firstSeen: now,
      lastConfirmed: now,
      confirmations: 1,
    },
    retention: defaultRetention('short_lived', now),
  };
}

test('active fact retrieval returns a compact candidate with provenance', () => {
  const { root, store, retrieval } = tempDb();
  try {
    const person = store.putEntity(entity());
    store.putFact(fact('architecture.memory_backend', 'architecture.memory_backend', 'SQLite', person.id));
    const context = retrieval.retrieveForTurn({ text: 'What is architecture.memory_backend?' });
    assert.equal(context.degraded, false);
    assert.equal(context.items.length, 1);
    assert.equal(context.items[0]?.canonicalId, 'fact:architecture.memory_backend');
    assert.equal(context.items[0]?.type, 'fact');
    assert.equal(context.items[0]?.status, 'active');
    assert.deepEqual(context.items[0]?.sourceRefs, ['obs:seed']);
    assert.match(context.promptBlock, /fact:architecture.memory_backend/u);
    assert.ok(context.promptBlock.length < 2_000);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('episodic retrieval returns episode candidates', () => {
  const { root, store, retrieval } = tempDb();
  try {
    store.putEpisode(episode('standup', 'standup moved to the lab notes'));
    const context = retrieval.retrieveForTurn({ text: 'standup notes' });
    assert.ok(context.items.some(item => item.canonicalId === 'episode:standup' && item.type === 'episode'));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('no-result query and empty database stay empty without degrading', () => {
  const { root, store, retrieval } = tempDb();
  try {
    const empty = retrieval.retrieveForTurn({ text: 'zzzxq empty-db-query' });
    assert.deepEqual(empty.items, []);
    assert.equal(empty.degraded, false);
    assert.equal(empty.promptBlock, '');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('forgotten and expired memories are excluded by default', () => {
  const { root, store, retrieval } = tempDb();
  try {
    const person = store.putEntity(entity());
    const forgotten = store.putFact(fact('secret.token', 'secret.token', 'hidden', person.id));
    store.forget(forgotten.id);
    const expiring = store.putFact({
      ...fact('temp.weather', 'temp.weather', 'hot', person.id),
      retention: { retentionClass: 'ephemeral', deletionPolicy: 'tombstone', expiresAt: 10 },
    });
    store.expireDue(50);
    const forgottenHit = retrieval.retrieveForTurn({ text: 'secret.token' });
    const expiredHit = retrieval.retrieveForTurn({ text: 'temp.weather' });
    assert.equal(forgottenHit.items.length, 0);
    assert.equal(expiredHit.items.length, 0);
    assert.equal(store.getFact(forgotten.id)?.status, 'forgotten');
    assert.equal(store.getFact(expiring.id)?.status, 'expired');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('active facts are preferred over superseded unless history is requested', () => {
  const { root, store, retrieval } = tempDb();
  try {
    const person = store.putEntity(entity());
    const friday = store.putFact(fact('meeting-a', 'meeting_day', 'Friday', person.id));
    store.supersedeFact(friday.id, fact('meeting-b', 'meeting_day', 'Saturday', person.id));
    const current = retrieval.retrieveForTurn({ text: 'meeting_day' });
    assert.equal(current.items.length, 1);
    assert.equal(current.items[0]?.text, 'Saturday');
    assert.equal(current.items[0]?.status, 'active');
    const history = retrieval.retrieveForTurn({ text: 'meeting_day previously' });
    assert.ok(history.items.length >= 2);
    assert.equal(history.items[0]?.status, 'active');
    assert.ok(history.items.some(item => item.status === 'superseded' && item.canonicalId === friday.id));
    const flagged = retrieval.retrieveForTurn({ text: 'meeting_day', includeSuperseded: true });
    assert.ok(flagged.items.some(item => item.status === 'superseded' && item.canonicalId === friday.id));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('turn retrieval is bounded', () => {
  const { root, store, retrieval } = tempDb();
  try {
    const person = store.putEntity(entity());
    for (let index = 0; index < 20; index += 1) {
      store.putFact(fact(`alpha-${index}`, `topic.alpha.${index}`, `alpha value ${index}`, person.id));
    }
    const context = retrieval.retrieveForTurn({ text: 'alpha', limit: 8 });
    assert.ok(context.items.length > 0);
    assert.ok(context.items.length <= 8);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('retrieval adapter degrades when the store throws', () => {
  const retrieval = new JarvisMemoryRetrieval({
    listFacts() { throw new Error('disk'); },
    listEpisodes() { throw new Error('disk'); },
    getById() { throw new Error('disk'); },
  } as unknown as JarvisMemoryStore);
  const context = retrieval.retrieveForTurn({ text: 'architecture.memory_backend' });
  assert.equal(context.degraded, true);
  assert.deepEqual(context.items, []);
  assert.equal(context.promptBlock, '');
  assert.match(context.reason || '', /disk/u);
});

test('Core degrades when memory is unavailable and still answers', async () => {
  const core = new LocalLlmJarvisCore(
    { generateText: async () => 'ตอบได้โดยไม่ใช้ความจำ' },
    {
      memory: {
        retrieveForTurn: () => {
          throw new Error('store offline');
        },
      },
    },
  );
  const result = await core.handle(createJarvisRequest({ text: 'hello', requestId: 'mem-down' }));
  assert.equal(result.suggestedContent, 'ตอบได้โดยไม่ใช้ความจำ');
  assert.deepEqual(result.memoryRefs, []);
  assert.match(result.uncertainty.join(' '), /Memory retrieval unavailable/u);
});

test('optional memory keeps a fresh Core working with no store', async () => {
  const core = new LocalLlmJarvisCore({ generateText: async () => 'fresh' });
  const result = await core.handle(createJarvisRequest({ text: 'hello', requestId: 'fresh' }));
  assert.equal(result.suggestedContent, 'fresh');
  assert.deepEqual(result.memoryRefs, []);
});

test('seeded architecture.memory_backend reaches structured Core memoryRefs', async () => {
  const { root, store, retrieval } = tempDb();
  try {
    const person = store.putEntity(entity());
    store.putFact(fact('architecture.memory_backend', 'architecture.memory_backend', 'SQLite', person.id));
    const core = new LocalLlmJarvisCore(
      { generateText: async () => 'I will use the attached evidence.' },
      { memory: retrieval },
    );
    const output = await runStandaloneTextTurn(
      { text: 'What is architecture.memory_backend?', requestId: 'mem-int' },
      { core, engine: new FactPreservingPresentationEngine() },
    );
    const ref = output.result.memoryRefs.find(item => item.canonicalId === 'fact:architecture.memory_backend');
    assert.ok(ref);
    assert.equal(ref.type, 'fact');
    assert.equal(ref.status, 'active');
    assert.deepEqual(ref.sourceRefs, ['obs:seed']);
    assert.equal(typeof output.presented.text, 'string');
    assert.ok(output.presented.text.length > 0);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('jarvis lab runtime is Discord-free and answers through Core', async () => {
  const lab = createJarvisLabRuntime({
    attachDefaultMemory: false,
    core: new LocalLlmJarvisCore({ generateText: async () => 'lab ok' }),
    llm: {
      generateText: async () => 'lab ok',
      getRuntimeStatus: async () => ({ enabled: true, reachable: false, model: 'test' }),
    },
  });
  const status = await lab.status();
  assert.equal(status.discordRequired, false);
  assert.equal(status.memory.attached, false);
  assert.equal(status.capabilities.attached, false);
  const asked = await lab.ask({ text: 'hello' });
  assert.ok(asked.presented.text.length > 0);
  assert.equal(asked.coreState, 'complete');
});

test('Core and presentation do not import SQLite or Discord, and presentation does not retrieve', () => {
  const sqlite = /node:sqlite|SqliteJarvisMemoryStore/u;
  const discord = /from\s+['"](?:discord(?:\.js)?|@discordjs\/)['"]/u;
  const retrieval = /JarvisMemoryRetrieval|retrieveForTurn/u;
  const files = [
    ...walk(path.join(process.cwd(), 'src', 'jarvis', 'core')),
    path.join(process.cwd(), 'src', 'jarvis', 'standalone', 'LocalLlmJarvisCore.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'memory', 'service.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'memory', 'intent.ts'),
    ...walk(path.join(process.cwd(), 'src', 'jarvis', 'presentation')),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'JarvisLabPage.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'JarvisCoreVisual.tsx'),
    path.join(process.cwd(), 'src', 'jarvis', 'ui', 'labUiState.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'audio', 'SpeechTurnController.ts'),
    path.join(process.cwd(), 'src', 'jarvis', 'audio', 'transcribeUtterance.ts'),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(sqlite.test(source), false, file);
    assert.equal(discord.test(source), false, file);
    if (file.includes(`${path.sep}presentation${path.sep}`) || file.endsWith('JarvisLabPage.tsx')) {
      assert.equal(retrieval.test(source), false, file);
    }
  }
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : /\.(?:ts|tsx)$/u.test(entry.name) ? [full] : [];
  });
}

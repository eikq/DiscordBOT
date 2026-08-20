import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MemoryConflictError,
  SqliteJarvisMemoryStore,
  canonicalMemoryId,
  defaultRetention,
} from '../src/bot/memory/jarvis';
import type { EntityRecord, EpisodeRecord, SemanticFactRecord } from '../src/bot/memory/jarvis/types';
import {
  JarvisMemoryRetrieval,
  applyOwnerCorrection,
  fuseMemoryRetrieval,
  parseOwnerCorrection,
  writeSemanticCandidateFromEpisode,
} from '../src/jarvis/memory';
import { writeExperienceEpisode } from '../src/jarvis/memory/experienceBridge';
import { runPresentationPipeline } from '../src/jarvis/presentation/briefing';

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function entity(id = 'owner'): EntityRecord {
  const now = 1_000;
  return {
    id: canonicalMemoryId('entity', id),
    kind: 'entity',
    entityType: 'person',
    displayName: 'Owner',
    status: 'active',
    privacyClass: 'private',
    confidence: 1,
    importance: 0.7,
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

function fact(
  localId: string,
  key: string,
  value: string,
  extra: Partial<SemanticFactRecord> = {},
): SemanticFactRecord {
  const now = extra.provenance?.firstSeen ?? 2_000;
  return {
    id: canonicalMemoryId('fact', localId),
    kind: 'fact',
    predicate: key,
    objectValue: value,
    factKey: key,
    polarity: 'statement',
    status: 'active',
    privacyClass: 'private',
    confidence: 0.9,
    importance: 0.8,
    provenance: {
      sourceSystem: extra.provenance?.sourceSystem ?? 'test',
      sourceRecordId: localId,
      evidenceIds: extra.provenance?.evidenceIds ?? ['obs:seed'],
      firstSeen: now,
      lastConfirmed: extra.provenance?.lastConfirmed ?? now,
      confirmations: 1,
    },
    retention: extra.retention ?? defaultRetention('long_lived', now),
    memoryClass: extra.memoryClass,
    ownerTrusted: extra.ownerTrusted,
    derived: extra.derived,
  };
}

function episode(localId: string, summary: string, extra: Partial<EpisodeRecord> = {}): EpisodeRecord {
  const now = Date.now();
  return {
    id: canonicalMemoryId('episode', localId),
    kind: 'episode',
    occurredAt: now,
    source: 'desktop',
    eventType: extra.eventType ?? 'task_success',
    summary,
    payload: extra.payload ?? { outcome: 'success' },
    status: 'active',
    privacyClass: 'private',
    confidence: extra.confidence ?? 0.8,
    importance: extra.importance ?? 0.8,
    provenance: {
      sourceSystem: extra.provenance?.sourceSystem ?? 'jarvis.experience',
      evidenceIds: [],
      firstSeen: now,
      lastConfirmed: now,
      confirmations: 1,
    },
    retention: defaultRetention('short_lived', now),
  };
}

test('schema v3 adds memory quality columns without replacing SQLite', () => {
  const root = tempRoot('digital-me-memv2-schema-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  try {
    assert.equal(store.schemaVersion(), 3);
    const person = store.putEntity(entity());
    const created = store.putFact(fact('favorite.color', 'favorite.color', 'blue', {
      ownerTrusted: true,
      memoryClass: 'identity',
      provenance: {
        sourceSystem: 'owner_correction',
        evidenceIds: ['owner:owner'],
        firstSeen: 2_000,
        lastConfirmed: 2_000,
        confirmations: 1,
      },
    }));
    assert.equal(created.ownerTrusted, true);
    assert.equal(created.derived, false);
    assert.equal(created.memoryClass, 'identity');
    assert.ok(created.createdAt);
    assert.ok(created.updatedAt);
    assert.equal(created.status, 'active');
    assert.ok(created.memoryRefs?.includes('owner:owner'));
    assert.equal(store.getEntity(person.id)?.displayName, 'Owner');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('contradictions throw and supersession keeps the old fact', () => {
  const root = tempRoot('digital-me-memv2-supersede-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  try {
    store.putEntity(entity());
    const old = store.putFact(fact('pref-a', 'favorite.drink', 'coffee', { memoryClass: 'identity', ownerTrusted: true }));
    assert.throws(
      () => store.putFact(fact('pref-b', 'favorite.drink', 'tea', { memoryClass: 'identity', ownerTrusted: true })),
      (error: unknown) => error instanceof MemoryConflictError,
    );
    const result = store.supersedeFact(old.id, fact('pref-b', 'favorite.drink', 'tea', { memoryClass: 'identity', ownerTrusted: true }));
    assert.equal(result.previous.status, 'superseded');
    assert.equal(result.previous.supersededBy, result.next.id);
    assert.equal(result.next.supersedes, old.id);
    assert.equal(store.getFact(old.id)?.status, 'superseded');
    assert.equal(store.listFacts({ factKey: 'favorite.drink' })[0]?.objectValue, 'tea');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('forget and expiry keep rows but hide them from retrieval', () => {
  const root = tempRoot('digital-me-memv2-forget-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const retrieval = new JarvisMemoryRetrieval(store);
  try {
    store.putEntity(entity());
    const kept = store.putFact(fact('keep', 'owner.note', 'keep me'));
    const gone = store.putFact(fact('forget-me', 'secret.token', 'hidden'));
    store.forget(gone.id);
    const expiring = store.putFact({
      ...fact('temp', 'temp.weather', 'hot'),
      retention: { retentionClass: 'ephemeral', deletionPolicy: 'tombstone', expiresAt: 10 },
    });
    assert.equal(store.expireDue(50), 1);
    assert.equal(store.getFact(gone.id)?.status, 'forgotten');
    assert.equal(store.getFact(expiring.id)?.status, 'expired');
    assert.equal(retrieval.retrieveForTurn({ text: 'secret.token' }).items.length, 0);
    assert.equal(retrieval.retrieveForTurn({ text: 'temp.weather' }).items.length, 0);
    assert.equal(retrieval.retrieveForTurn({ text: 'owner.note' }).items[0]?.canonicalId, kept.id);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('hybrid fusion hydrates SQLite text and drops orphan vectors', () => {
  const root = tempRoot('digital-me-memv2-fusion-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const retrieval = new JarvisMemoryRetrieval(store);
  try {
    store.putEntity(entity());
    const sqliteOnly = store.putFact(fact('vector-hit', 'project.backend', 'SQLite', { memoryClass: 'semantic' }));
    const lexical = retrieval.retrieve({ query: 'backend', kinds: ['fact'] });
    const fused = fuseMemoryRetrieval({
      lexical,
      semantic: [
        { canonicalId: sqliteOnly.id, score: 0.99, text: 'index snippet must not win' },
        { canonicalId: 'fact:ghost', score: 1, text: 'no sqlite record' },
      ],
      canonicalById: new Map(lexical.map(item => [item.canonicalId, item])),
      topK: 4,
    });
    assert.equal(fused.canonicalStore, 'sqlite');
    assert.equal(fused.qdrantRole, 'derived_index');
    assert.equal(fused.items.some(item => item.canonicalId === 'fact:ghost'), false);
    assert.equal(fused.items.find(item => item.canonicalId === sqliteOnly.id)?.text, 'SQLite');

    const turn = retrieval.retrieveForTurn({
      text: 'how do I restart the night agent backend',
      semanticHits: [
        { canonicalId: sqliteOnly.id, score: 0.9, text: 'index snippet' },
        { canonicalId: 'fact:ghost', score: 1, text: 'orphan' },
      ],
    });
    assert.equal(turn.items.some(item => item.canonicalId === 'fact:ghost'), false);
    assert.ok(turn.items.some(item => item.canonicalId === sqliteOnly.id && item.text === 'SQLite'));
    assert.ok(turn.items[0]?.retrievalScores);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('query-aware retrieval does not dump every memory class', () => {
  const root = tempRoot('digital-me-memv2-class-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const retrieval = new JarvisMemoryRetrieval(store);
  try {
    store.putEntity(entity());
    store.putFact(fact('fav', 'favorite.color', 'blue', { memoryClass: 'identity', ownerTrusted: true }));
    store.putFact(fact('proc', 'procedure.restart', 'systemctl restart jarvis', { memoryClass: 'procedural' }));
    store.putFact(fact('cam', 'device.camera.living', 'online', { memoryClass: 'perceptual' }));
    const conversation = retrieval.retrieveForTurn({ text: 'hello spin how are you' });
    assert.ok(conversation.items.some(item => item.canonicalId === 'fact:fav'));
    assert.equal(conversation.items.some(item => item.canonicalId === 'fact:proc'), false);
    assert.equal(conversation.requestClass, 'conversation');

    const technical = retrieval.retrieveForTurn({ text: 'how do I restart the night agent' });
    assert.ok(technical.items.some(item => item.canonicalId === 'fact:proc'));
    assert.equal(technical.items.some(item => item.canonicalId === 'fact:fav'), false);
    assert.equal(technical.requestClass, 'technical');

    const device = retrieval.retrieveForTurn({ text: 'is the living room camera online' });
    assert.ok(device.items.some(item => item.canonicalId === 'fact:cam'));
    assert.equal(device.items.some(item => item.canonicalId === 'fact:fav'), false);
    assert.equal(device.requestClass, 'device');
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('turn retrieval stays bounded and exposes score metadata', () => {
  const root = tempRoot('digital-me-memv2-budget-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const retrieval = new JarvisMemoryRetrieval(store);
  try {
    store.putEntity(entity());
    for (let index = 0; index < 20; index += 1) {
      store.putFact(fact(`alpha-${index}`, `topic.alpha.${index}`, `alpha value ${index}`, {
        memoryClass: 'semantic',
        importance: index / 20,
      }));
    }
    const context = retrieval.retrieveForTurn({ text: 'alpha', limit: 8 });
    assert.ok(context.items.length > 0);
    assert.ok(context.items.length <= 8);
    assert.ok(context.promptBlock.length < 2_000);
    assert.ok(context.items.every(item => item.retrievalScores && typeof item.retrievalScores.total === 'number'));
    assert.match(context.promptBlock, /sc=/u);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('owner correction remember, change, reject, and forget', () => {
  const root = tempRoot('digital-me-memv2-owner-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  const retrieval = new JarvisMemoryRetrieval(store);
  try {
    store.putEntity(entity());
    assert.equal(parseOwnerCorrection('จำอันนี้ favorite.color = blue').action, 'remember');
    const remembered = applyOwnerCorrection(store, 'จำอันนี้ favorite.color = blue');
    assert.equal(remembered.applied, true);
    const current = store.listFacts({ factKey: 'favorite.color' })[0];
    assert.equal(current?.objectValue, 'blue');
    assert.equal(current?.ownerTrusted, true);
    assert.equal(current?.status, 'active');

    const changed = applyOwnerCorrection(store, 'เปลี่ยนเป็น favorite.color = green');
    assert.equal(changed.applied, true);
    assert.equal(store.getFact(current!.id)?.status, 'superseded');
    assert.equal(store.listFacts({ factKey: 'favorite.color' })[0]?.objectValue, 'green');

    const reject = applyOwnerCorrection(store, 'อันนี้ไม่ใช่ favorite.color');
    assert.equal(reject.applied, true);
    assert.equal(store.getFact(reject.factIds[0]!)?.status, 'forgotten');

    applyOwnerCorrection(store, 'remember that favorite.drink is coffee');
    const forgotten = applyOwnerCorrection(store, 'ลืมเรื่องนี้ favorite.drink');
    assert.equal(forgotten.applied, true);
    assert.equal(retrieval.retrieveForTurn({ text: 'favorite.drink' }).items.length, 0);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('episode candidate pipeline never auto-promotes, and research stays untrusted', () => {
  const root = tempRoot('digital-me-memv2-learn-');
  const store = new SqliteJarvisMemoryStore(path.join(root, 'jarvis.db'));
  try {
    const learned = store.putEpisode(episode('restart', 'restart playbook', {
      payload: {
        outcome: 'success',
        factKey: 'procedure.restart',
        factValue: 'use systemctl restart jarvis',
        trustedSemanticWrite: false,
      },
    }));
    const candidate = writeSemanticCandidateFromEpisode(store, learned);
    assert.equal(candidate?.status, 'candidate');
    assert.equal(candidate?.ownerTrusted, false);
    assert.equal(store.listFacts({ factKey: 'procedure.restart' }).length, 0);
    const accepted = store.acceptCandidate(candidate!.id);
    assert.equal(accepted.candidate.status, 'accepted');
    assert.equal(accepted.fact.ownerTrusted, false);
    assert.equal(accepted.fact.derived, true);
    assert.equal(accepted.fact.objectValue, 'use systemctl restart jarvis');

    const researchEpisode = writeExperienceEpisode(store, {
      id: 'exp_research',
      createdAt: new Date(4_000).toISOString(),
      kind: 'episodic',
      domain: 'research',
      goal: 'search the web',
      situation: 'search the web',
      actions: ['research'],
      tools: ['research.search'],
      result: 'a claim from the web',
      outcome: 'success',
      lessons: [],
      confidence: 0.9,
      privacyClass: 'private',
      significance: 0.8,
    }, {
      id: 'task_research1',
      objective: 'search the web',
      createdAt: new Date(4_000).toISOString(),
      updatedAt: new Date(4_000).toISOString(),
      status: 'COMPLETED',
      outcome: 'success',
      plan: [],
      evidence: ['untrusted:research.search'],
      toolResults: [{ capability: 'research.search', status: 'ok', summary: 'untrusted' }],
      permissionRequirements: [],
      retryBudget: 1,
      retriesUsed: 0,
      errors: [],
    });
    assert.equal(researchEpisode.payload.untrustedResearch, true);
    assert.equal(researchEpisode.payload.trustedSemanticWrite, false);
    const rejected = store.listCandidates({ status: 'rejected' });
    assert.ok(rejected.some(item => item.reason === 'untrusted_research'));
    assert.equal(store.listFacts({ query: 'claim from the web' }).length, 0);
    assert.throws(
      () => store.acceptCandidate(rejected[0]!.id),
      /rejected|Research claims/iu,
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('presenter can show memory provenance without hidden reasoning', () => {
  const planned = runPresentationPipeline({
    text: 'Why did you remember my favorite color?',
    replyText: 'I used the stored owner-trusted favorite.color fact as evidence.',
    showMemoryProvenance: true,
    memoryProvenance: [{
      canonicalId: 'fact:fav',
      text: 'blue',
      status: 'active',
      sourceSystem: 'owner_correction',
      sourceRefs: ['owner:owner'],
      memoryClass: 'identity',
      ownerTrusted: true,
      derived: false,
    }],
  });
  assert.notEqual(planned.density, 'plain');
  if (planned.density === 'plain') return;
  const memory = planned.sections.find(section => section.id === 'sec-memory');
  assert.ok(memory);
  assert.match(memory.body, /Jarvis remembered this because/u);
  assert.match(memory.body, /owner_correction/u);
  assert.equal(JSON.stringify(planned).includes('chainOfThought'), false);
  assert.equal(JSON.stringify(planned).includes('hiddenReasoning'), false);
});

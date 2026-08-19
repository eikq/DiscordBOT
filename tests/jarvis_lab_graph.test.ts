import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteJarvisMemoryStore, canonicalMemoryId, defaultRetention } from '../src/bot/memory/jarvis';
import type { EntityRecord, EpisodeRecord, ObservationRecord, RelationshipRecord, SemanticFactRecord } from '../src/bot/memory/jarvis/types';
import { emptyMemoryGraph, MemoryGraphAdapter } from '../src/jarvis/memory/graphAdapter';
import { edgesOnPath, haloRadiusForCount, hashSeed, layoutGraph, shortestGraphPath } from '../src/jarvis/ui/graph/graphLayout';
import { graphCategoriesOf, graphCategoryColor } from '../src/jarvis/ui/graph/graphTypes';
import type { GraphEdge, GraphNode } from '../src/jarvis/ui/graph/graphTypes';

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const NOW = 1_700_000_000_000;

function entity(localId: string, name: string, privacy: EntityRecord['privacyClass'] = 'private'): EntityRecord {
  return {
    id: canonicalMemoryId('entity', localId),
    kind: 'entity',
    entityType: 'person',
    displayName: name,
    status: 'active',
    privacyClass: privacy,
    confidence: 1,
    importance: 0.7,
    provenance: {
      sourceSystem: 'test',
      sourceRecordId: localId,
      evidenceIds: [],
      firstSeen: NOW,
      lastConfirmed: NOW,
      confirmations: 1,
    },
    retention: defaultRetention('long_lived', NOW),
  };
}

function observation(localId: string, text: string): ObservationRecord {
  return {
    id: canonicalMemoryId('observation', localId),
    kind: 'observation',
    occurredAt: NOW,
    source: 'test',
    eventType: 'note',
    text,
    payload: {},
    status: 'active',
    privacyClass: 'private',
    confidence: 0.9,
    importance: 0.4,
    provenance: {
      sourceSystem: 'test',
      sourceRecordId: localId,
      evidenceIds: [],
      firstSeen: NOW,
      lastConfirmed: NOW,
      confirmations: 1,
    },
    retention: defaultRetention('audit', NOW),
  };
}

function fact(localId: string, key: string, value: string, subjectId: string, evidence: string[]): SemanticFactRecord {
  return {
    id: canonicalMemoryId('fact', localId),
    kind: 'fact',
    subjectEntityId: subjectId,
    predicate: 'has',
    objectValue: value,
    factKey: key,
    polarity: 'statement',
    status: 'active',
    privacyClass: 'private',
    confidence: 0.85,
    importance: 0.6,
    provenance: {
      sourceSystem: 'test',
      sourceRecordId: localId,
      evidenceIds: evidence,
      firstSeen: NOW,
      lastConfirmed: NOW,
      confirmations: 1,
    },
    retention: defaultRetention('long_lived', NOW),
  };
}

function episode(localId: string, summary: string): EpisodeRecord {
  return {
    id: canonicalMemoryId('episode', localId),
    kind: 'episode',
    occurredAt: NOW,
    source: 'test',
    eventType: 'meeting',
    summary,
    payload: {},
    status: 'active',
    privacyClass: 'private',
    confidence: 0.7,
    importance: 0.5,
    provenance: {
      sourceSystem: 'test',
      sourceRecordId: localId,
      evidenceIds: [],
      firstSeen: NOW,
      lastConfirmed: NOW,
      confirmations: 1,
    },
    retention: defaultRetention('short_lived', NOW),
  };
}

function relationship(leftId: string, rightId: string): RelationshipRecord {
  const [left, right] = [leftId, rightId].sort();
  return {
    id: canonicalMemoryId('relationship', `${left.split(':')[1]}:${right.split(':')[1]}`),
    kind: 'relationship',
    leftEntityId: left,
    rightEntityId: right,
    interactionCount: 3,
    addressTerms: {},
    status: 'active',
    privacyClass: 'private',
    confidence: 0.8,
    importance: 0.6,
    provenance: {
      sourceSystem: 'test',
      evidenceIds: [],
      firstSeen: NOW,
      lastConfirmed: NOW,
      confirmations: 3,
    },
    retention: defaultRetention('long_lived', NOW),
  };
}

test('memory graph snapshot exposes only real nodes and relationships', () => {
  const root = tempRoot('jarvis-graph-');
  const dbPath = path.join(root, 'jarvis.db');
  const store = new SqliteJarvisMemoryStore(dbPath);
  try {
    const gam = store.putEntity(entity('u1', 'Gam'));
    const spin = store.putEntity(entity('u2', 'Spin'));
    const secret = store.putEntity(entity('u3', 'Hidden Person', 'secret'));
    const obs = store.putObservation(observation('o1', 'heard about snacks'));
    const snack = store.putFact(fact('snack', 'favorite_snack', 'mango', gam.id, [obs.id]));
    const meet = store.putEpisode(episode('standup', 'standup moved to Friday'));
    store.putRelationship(relationship(gam.id, spin.id));
    store.link(snack.id, meet.id, 'supported_by');

    const adapter = new MemoryGraphAdapter(dbPath);
    try {
      const snapshot = adapter.snapshot();
      assert.equal(snapshot.attached, true);
      const ids = new Set(snapshot.nodes.map(node => node.id));
      assert.ok(ids.has(gam.id));
      assert.ok(ids.has(spin.id));
      assert.ok(ids.has(snack.id));
      assert.ok(ids.has(meet.id));
      assert.ok(ids.has(obs.id), 'referenced evidence observation is included');

      const secretNode = snapshot.nodes.find(node => node.id === secret.id);
      assert.ok(secretNode);
      assert.equal(secretNode?.label, secret.id, 'secret entities never leak display names');

      const kinds = new Set(snapshot.edges.map(edge => edge.kind));
      assert.ok(kinds.has('fact-subject'));
      assert.ok(kinds.has('relationship'));
      assert.ok(kinds.has('link'));
      assert.ok(kinds.has('evidence'));

      for (const edge of snapshot.edges) {
        assert.ok(ids.has(edge.source), `edge source exists ${edge.source}`);
        assert.ok(ids.has(edge.target), `edge target exists ${edge.target}`);
      }
      const gamNode = snapshot.nodes.find(node => node.id === gam.id);
      assert.ok((gamNode?.degree ?? 0) >= 2, 'degree counts fact-subject and relationship edges');
      assert.equal(snapshot.counts.entities, 3);
      assert.equal(snapshot.counts.facts, 1);
    } finally {
      adapter.close();
    }
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('node detail returns provenance and stored relations without inventing links', () => {
  const root = tempRoot('jarvis-graph-detail-');
  const dbPath = path.join(root, 'jarvis.db');
  const store = new SqliteJarvisMemoryStore(dbPath);
  try {
    const gam = store.putEntity(entity('u1', 'Gam'));
    store.putAlias(gam.id, 'แก้ม', 0.9);
    const obs = store.putObservation(observation('o1', 'observed'));
    const snack = store.putFact(fact('snack', 'favorite_snack', 'mango', gam.id, [obs.id]));

    const adapter = new MemoryGraphAdapter(dbPath);
    try {
      const entityDetail = adapter.nodeDetail(gam.id);
      assert.equal(entityDetail.found, true);
      assert.equal(entityDetail.kind, 'entity');
      assert.equal(entityDetail.displayName, 'Gam');
      assert.deepEqual(entityDetail.aliases, ['แก้ม']);
      assert.equal(entityDetail.provenance?.sourceSystem, 'test');
      assert.ok(entityDetail.relations.some(rel => rel.otherId === snack.id));

      const factDetail = adapter.nodeDetail(snack.id);
      assert.equal(factDetail.found, true);
      assert.equal(factDetail.factKey, 'favorite_snack');
      assert.equal(factDetail.objectValue, 'mango');
      assert.deepEqual(factDetail.provenance?.evidenceIds, [obs.id]);
      assert.ok(factDetail.relations.some(rel => rel.otherId === gam.id));

      const missing = adapter.nodeDetail('fact:does-not-exist');
      assert.equal(missing.found, false);
      assert.deepEqual(missing.relations, []);
    } finally {
      adapter.close();
    }
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('graph adapter refuses a missing store and empty graph carries the reason', () => {
  assert.throws(() => new MemoryGraphAdapter(path.join(os.tmpdir(), 'nope', 'missing.db')));
  const empty = emptyMemoryGraph('Memory store is not attached.');
  assert.equal(empty.attached, false);
  assert.equal(empty.reason, 'Memory store is not attached.');
  assert.equal(empty.nodes.length, 0);
});

function graphNode(id: string, category: string, degree = 0): GraphNode {
  return {
    id,
    kind: 'fact',
    category,
    label: id,
    status: 'active',
    confidence: 0.8,
    importance: 0.5,
    privacyClass: 'private',
    degree,
  };
}

test('graph layout is deterministic, clustered by category, and finite', () => {
  const nodes = [
    graphNode('fact:a', 'fact', 2),
    graphNode('fact:b', 'fact'),
    graphNode('entity:u1', 'person', 3),
    graphNode('entity:u2', 'person'),
    graphNode('episode:e1', 'episode'),
  ];
  const edges: GraphEdge[] = [
    { id: 'e1', source: 'entity:u1', target: 'fact:a', relation: 'has', kind: 'fact-subject' },
  ];
  const first = layoutGraph(nodes, edges);
  const second = layoutGraph(nodes, edges);
  assert.deepEqual([...first.positions.entries()], [...second.positions.entries()], 'layout is deterministic');
  assert.equal(first.positions.size, nodes.length);
  const unique = new Set([...first.positions.values()].map(pos => pos.join(',')));
  assert.equal(unique.size, nodes.length, 'positions are distinct');
  for (const pos of first.positions.values()) {
    assert.ok(pos.every(value => Number.isFinite(value)));
  }
  const personCenter = first.clusterCenters.get('person')!;
  const factCenter = first.clusterCenters.get('fact')!;
  const distance = Math.hypot(personCenter[0] - factCenter[0], personCenter[1] - factCenter[1], personCenter[2] - factCenter[2]);
  assert.ok(distance > 10, 'categories occupy separate regions');
  assert.ok(hashSeed('a') !== hashSeed('b'));
});

test('sparse real graphs use a tight halo so they read as connected to the core', () => {
  assert.equal(haloRadiusForCount(2), 15);
  assert.equal(haloRadiusForCount(10), 18);
  assert.equal(haloRadiusForCount(40), 26);
  const sparse = layoutGraph([
    graphNode('entity:sys', 'other', 1),
    graphNode('fact:architecture.memory_backend', 'fact', 1),
  ], [{ id: 'e', source: 'entity:sys', target: 'fact:architecture.memory_backend', relation: 'has', kind: 'fact-subject' }]);
  assert.equal(sparse.radius, 15);
  for (const pos of sparse.positions.values()) {
    const radius = Math.hypot(pos[0], pos[1], pos[2]);
    assert.ok(radius < 22, 'idle nodes stay near the core instead of the outer field');
    assert.ok(radius > 8, 'nodes remain outside the nucleus');
  }
});

test('shortest path search follows real edges only', () => {
  const edges: GraphEdge[] = [
    { id: 'e1', source: 'a', target: 'b', relation: 'x', kind: 'link' },
    { id: 'e2', source: 'b', target: 'c', relation: 'x', kind: 'link' },
    { id: 'e3', source: 'c', target: 'd', relation: 'x', kind: 'link' },
    { id: 'e4', source: 'z', target: 'y', relation: 'x', kind: 'link' },
  ];
  assert.deepEqual(shortestGraphPath(edges, 'a', 'd'), ['a', 'b', 'c', 'd']);
  assert.equal(shortestGraphPath(edges, 'a', 'z'), null, 'disconnected nodes have no path');
  assert.deepEqual(shortestGraphPath(edges, 'a', 'a'), ['a']);
  const highlighted = edgesOnPath(edges, ['a', 'b', 'c']);
  assert.deepEqual([...highlighted].sort(), ['e1', 'e2']);
  assert.equal(edgesOnPath(edges, null).size, 0);
});

test('graph categories aggregate counts and colors stay defined', () => {
  const categories = graphCategoriesOf([
    graphNode('a', 'fact'),
    graphNode('b', 'fact'),
    graphNode('c', 'person'),
  ]);
  assert.deepEqual(categories, [
    { category: 'fact', count: 2 },
    { category: 'person', count: 1 },
  ]);
  assert.match(graphCategoryColor('fact'), /^#/);
  assert.match(graphCategoryColor('never-seen-category'), /^#/);
});

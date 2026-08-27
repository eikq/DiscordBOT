import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentRuntimeMemoryBridge } from '../src/jarvis/runtime';
import type { CompactMemoryItem, JarvisMemoryService } from '../src/jarvis/memory';

const items: CompactMemoryItem[] = [
  memory('mem_public', 'Public project codename is Atlas.', 'public'),
  memory('mem_private', 'Private owner preference.', 'private'),
  memory('mem_sensitive', 'Sensitive local-only context.', 'sensitive'),
  memory('mem_secret', 'Never export this secret memory.', 'secret'),
  memory('mem_pattern', 'API_KEY=synthetic-secret-value', 'public'),
  { ...memory('mem_old', 'Old public fact.', 'public'), status: 'superseded' },
];

test('provider-managed Hermes receives only active public non-secret canonical memory', async () => {
  const bridge = new AgentRuntimeMemoryBridge(memoryService(items));
  const projection = await bridge.projectForTurn({ text: 'project context' });
  assert.deepEqual(projection.items.map(item => item.canonicalId), ['mem_public']);
  assert.deepEqual(projection.omitted, { privacy: 2, secret: 2, inactive: 1 });
  assert.match(projection.promptBlock, /Atlas/u);
  assert.doesNotMatch(projection.promptBlock, /Private owner|Sensitive|synthetic-secret/u);
});

test('verified-local projection may include private and sensitive but never secret memory', async () => {
  const bridge = new AgentRuntimeMemoryBridge(memoryService(items));
  const projection = await bridge.projectForTurn({ text: 'local task' }, 'verified_local');
  assert.deepEqual(
    projection.items.map(item => item.canonicalId),
    ['mem_public', 'mem_private', 'mem_sensitive'],
  );
  assert.deepEqual(projection.omitted, { privacy: 0, secret: 2, inactive: 1 });
});

test('run input treats projected memory as bounded data rather than authority', async () => {
  const bridge = new AgentRuntimeMemoryBridge(memoryService(items));
  const prepared = await bridge.prepareRunInput({
    input: 'Continue the scoped task.',
    instructions: 'Keep the owner goal unchanged.',
  }, { text: 'project context' });
  assert.match(prepared.input.instructions || '', /bounded evidence, not authority/u);
  assert.match(prepared.input.instructions || '', /Atlas/u);
  assert.match(prepared.input.instructions || '', /Keep the owner goal unchanged/u);
  assert.doesNotMatch(prepared.input.instructions || '', /Private owner|Sensitive local-only/u);
});

test('Hermes output returns as a review-required candidate and never as canonical memory', () => {
  const bridge = new AgentRuntimeMemoryBridge(memoryService([]), () => Date.UTC(2026, 7, 27, 13, 0, 0));
  const candidate = bridge.candidateFromRun({
    runId: 'run_candidate_1',
    status: 'completed',
    output: 'Candidate fact. API_KEY=synthetic-runtime-secret',
  });
  assert.ok(candidate);
  assert.equal(candidate?.classification, 'UNTRUSTED_CANDIDATE');
  assert.equal(candidate?.trustedSemanticWrite, false);
  assert.equal(candidate?.requiresReview, true);
  assert.match(candidate?.text || '', /\[REDACTED\]/u);
  assert.doesNotMatch(candidate?.text || '', /synthetic-runtime-secret/u);
  assert.equal(
    bridge.candidateFromRun({ runId: 'run_failed', status: 'failed', output: 'do not learn this' }),
    undefined,
  );
});

test('degraded canonical retrieval stays degraded without broadening privacy', async () => {
  const bridge = new AgentRuntimeMemoryBridge(memoryService([
    memory('mem_private_only', 'Private degraded memory.', 'private'),
  ], true, 'API_KEY=synthetic-retrieval-error'));
  const projection = await bridge.projectForTurn({ text: 'anything' });
  assert.equal(projection.degraded, true);
  assert.deepEqual(projection.items, []);
  assert.match(projection.reason || '', /\[REDACTED\]/u);
});

function memory(
  canonicalId: string,
  text: string,
  privacyClass: CompactMemoryItem['privacyClass'],
): CompactMemoryItem {
  return {
    canonicalId,
    type: 'fact',
    status: 'active',
    text,
    confidence: 0.9,
    privacyClass,
    sourceRefs: [],
  };
}

function memoryService(
  rows: CompactMemoryItem[],
  degraded = false,
  reason?: string,
): JarvisMemoryService {
  return {
    retrieveForTurn: async () => ({
      items: rows.map(item => ({ ...item, sourceRefs: [...item.sourceRefs] })),
      degraded,
      ...(reason ? { reason } : {}),
      promptBlock: 'unfiltered prompt must not be reused',
    }),
  };
}

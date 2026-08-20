import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JarvisEventBus,
  classifyFailure,
  formatSseEvent,
  mergeBudgets,
  parseLastEventId,
  sseCursorFrom,
  visualStateFromEvent,
  visualStateFromEvents,
  writeSseReplay,
} from '../src/jarvis';
import { budgetExceeded } from '../src/jarvis/ops/budgets';

test('event bus bounds the buffer, redacts secrets, and supports reconnect cursors', () => {
  const bus = new JarvisEventBus(() => 1_000, 5);
  for (let i = 0; i < 8; i += 1) {
    bus.emit('PROGRESS', `step ${i}`, { i }, 'info', { taskId: 'task_1', progress: { current: i, total: 8 } });
  }
  assert.equal(bus.size(), 5);
  assert.equal(bus.maxSize(), 5);
  assert.equal(bus.recent(10).length, 5);
  const after = bus.recentAfter(4);
  assert.ok(after.every(event => event.seq > 4));
  bus.emit('ERROR', 'DISCORD_TOKEN=supersecretvalue', { cookie: 'sid=abc' }, 'error', { simulated: true, errorCode: 'STEP_FAILED' });
  const last = bus.recent(1)[0];
  assert.doesNotMatch(last.summary, /supersecretvalue/);
  assert.equal(last.payload.cookie, '[REDACTED]');
  assert.equal(last.simulated, true);
  assert.equal(last.seq, bus.lastSeq());
  const sse = formatSseEvent(last);
  assert.match(sse, /^id: /u);
  assert.match(sse, /data: /u);
  assert.equal(parseLastEventId('12'), 12);
  assert.equal(parseLastEventId('nope'), undefined);
  assert.equal(sseCursorFrom('3', '9'), 3);
  assert.equal(sseCursorFrom(undefined, '9'), 9);
  const replay: string[] = [];
  writeSseReplay(after, chunk => { replay.push(chunk); });
  assert.equal(replay.length, after.length);
  assert.match(replay[0] || '', /^id: /u);
});

test('visual states come from real events and never invent chain-of-thought', () => {
  assert.equal(visualStateFromEvent({ type: 'SEARCH', level: 'info' }), 'WEB_SEARCH');
  assert.equal(visualStateFromEvent({ type: 'PRIVILEGE_REQUEST', level: 'info' }), 'WAITING_PERMISSION');
  assert.equal(visualStateFromEvent({ type: 'MODEL', level: 'info' }), 'MODEL_GENERATING');
  assert.equal(visualStateFromEvents([]), 'IDLE');
  const bus = new JarvisEventBus();
  bus.emit('PLANNING', 'Planning 7 steps', {}, 'info', { visualState: 'PLANNING', progress: { current: 0, total: 7 } });
  assert.equal(visualStateFromEvents(bus.recent()), 'PLANNING');
  assert.doesNotMatch(JSON.stringify(bus.recent()), /scratchpad|chain-of-thought/i);
});

test('error taxonomy and budgets stay bounded', () => {
  assert.equal(classifyFailure({ reasonCode: 'timeout' }), 'RESEARCH_TIMEOUT');
  assert.equal(classifyFailure({ message: 'permission required' }), 'PERMISSION_REQUIRED');
  assert.equal(classifyFailure({ message: 'cycle detected' }), 'DEPENDENCY_CYCLE');
  const budgets = mergeBudgets({ retries: 99, taskSteps: 0 });
  assert.equal(budgets.retries, 6);
  assert.equal(budgets.taskSteps, 1);
  assert.equal(budgetExceeded(2, 2), true);
});

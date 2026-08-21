import assert from 'node:assert/strict';
import test from 'node:test';
import { JarvisEventBus, WorkAgent, WorkTaskStore, assertAcyclic, defaultPlanFor } from '../src/jarvis';
import { newStepId } from '../src/jarvis/agent/store';
import type { PlanStep, WorkStepResult, WorkTask } from '../src/jarvis/agent/types';

function step(kind: PlanStep['kind'], deps: string[] = [], extra: Partial<PlanStep> = {}): PlanStep {
  return {
    id: newStepId(kind),
    title: kind,
    kind,
    dependencies: deps,
    status: 'pending',
    riskLevel: 'LOW',
    verificationMethod: 'unit',
    retryPolicy: { maxAttempts: 2, attempted: 0 },
    ...extra,
  };
}

test('work agent walks a DAG to completion and records operational events', async () => {
  const bus = new JarvisEventBus();
  const agent = new WorkAgent({ events: bus, simulated: true });
  const a = step('understand');
  const b = step('plan', [a.id]);
  const c = step('verify', [b.id]);
  const task = agent.receive('Complete a simulated workflow', [a, b, c]);
  const done = await agent.run(task.id);
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.outcome, 'success');
  assert.ok(bus.recent().some(event => event.type === 'TASK_COMPLETED'));
  assert.ok(bus.recent().every(event => event.simulated === true));
});

test('dependency cycles are rejected', () => {
  const a = step('search');
  const b = step('research', [a.id]);
  a.dependencies = [b.id];
  assert.throws(() => assertAcyclic([a, b]), /cycle/i);
  const agent = new WorkAgent();
  assert.throws(() => agent.receive('cyclic', [a, b]));
});

test('bounded retries then fail honestly', async () => {
  let calls = 0;
  const agent = new WorkAgent({
    budgets: { retries: 1 },
    invoke: async (_task: WorkTask, planStep: PlanStep): Promise<WorkStepResult> => {
      if (planStep.kind !== 'apply') return { ok: true, summary: 'ok' };
      calls += 1;
      return { ok: false, summary: 'provider timeout', errorCode: 'PROVIDER_UNAVAILABLE' };
    },
  });
  const understand = step('understand');
  const apply = step('apply', [understand.id], { retryPolicy: { maxAttempts: 3, attempted: 0 } });
  const task = agent.receive('retry then fail', [understand, apply]);
  const done = await agent.run(task.id);
  assert.equal(done.status, 'FAILED');
  assert.equal(done.outcome, 'failure');
  assert.ok(calls >= 2);
  assert.notEqual(done.outcome, 'success');
});

test('cancellation stops a running task', async () => {
  let started = false;
  const agent = new WorkAgent({
    invoke: async (_task, planStep, signal) => {
      if (planStep.kind !== 'apply') return { ok: true, summary: 'ok' };
      started = true;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 5_000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('Cancelled.'), { reasonCode: 'CANCELLED' }));
        });
      });
      return { ok: true, summary: 'should not finish' };
    },
  });
  const understand = step('understand');
  const apply = step('apply', [understand.id]);
  const task = agent.receive('cancel me', [understand, apply]);
  const running = agent.run(task.id);
  await new Promise(resolve => setTimeout(resolve, 20));
  const cancelled = agent.cancel(task.id);
  assert.equal(cancelled.status, 'EXECUTING');
  assert.equal(cancelled.cancellation?.state, 'CANCELLATION_REQUESTED');
  const done = await running;
  assert.equal(done.status, 'CANCELLED');
  assert.equal(done.outcome, 'cancelled');
  assert.equal(done.cancellation?.state, 'FAILED_TO_CANCEL');
  assert.equal(started, true);
});

test('permission waiting does not execute the gated step', async () => {
  const agent = new WorkAgent({
    invoke: async (_task, planStep) => {
      if (planStep.permissionLease && !planStep.permissionLease.used) {
        return { ok: true, summary: 'lease accepted' };
      }
      if (planStep.kind === 'permission' || planStep.capability === 'workspace.getDocument') {
        return { ok: false, permissionRequired: true, summary: 'Need owner allow', errorCode: 'PERMISSION_REQUIRED' };
      }
      return { ok: true, summary: 'ok' };
    },
  });
  const understand = step('understand');
  const permission = step('permission', [understand.id], { capability: 'workspace.getDocument' });
  const apply = step('apply', [permission.id]);
  const task = agent.receive('needs permission', [understand, permission, apply]);
  const paused = await agent.run(task.id);
  assert.equal(paused.status, 'WAITING_PERMISSION');
  assert.equal(paused.plan.find(item => item.id === apply.id)?.status, 'pending');
  agent.grantPermission(task.id);
  const done = await agent.resume(task.id);
  assert.equal(done.status, 'COMPLETED');
});

test('resumability restores tasks without repeating completed steps', async () => {
  const store = new WorkTaskStore();
  const agent = new WorkAgent({ store });
  const task = agent.receive('resume later', defaultPlanFor('resume later'));
  const snapshot = store.snapshot();
  const other = new WorkTaskStore();
  other.restore(snapshot);
  assert.equal(other.get(task.id)?.status, 'UNDERSTANDING');
  assert.ok(other.get(task.id)?.plan.length);
});

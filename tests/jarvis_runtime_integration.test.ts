import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  CommandCenterRuntime,
  ExperienceStore,
  NightCycle,
  SkillVersionRegistry,
  WorkAgent,
  WorkTaskStore,
  createCapabilityWorkInvoker,
  planForObjective,
  reflectStructured,
} from '../src/jarvis';
import { CapabilityRegistry } from '../src/jarvis/capabilities/CapabilityRegistry';
import type { CapabilityHost, CapabilityResult } from '../src/jarvis/capabilities/types';
import { EvolutionPersistence } from '../src/jarvis/evolution/persist';
import { applyTaskOutcome } from '../src/jarvis/evolution/lifecycle';
import { ReflectionLedger } from '../src/jarvis/evolution/reflectionLedger';
import { FailureLedger } from '../src/jarvis/evolution/failureLearning';
import { CapabilitySelfModel } from '../src/jarvis/evolution/selfModel';
import { isBlockedCapabilityId } from '../src/jarvis/agent/capabilityResolve';
import { parseNightAction, parseObjective } from '../src/jarvis/standalone/commandCenterHttp';
import type { PlanStep, WorkTask } from '../src/jarvis/agent/types';

function tempRoot(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function result(id: string, extra: Partial<CapabilityResult> = {}): CapabilityResult {
  return {
    capabilityId: id,
    status: 'ok',
    structured: { ok: true },
    content: extra.content ?? `${id} ok`,
    sourceUrls: extra.sourceUrls ?? [],
    untrustedOutput: extra.untrustedOutput ?? false,
    sideEffect: extra.sideEffect ?? 'read',
    ...extra,
  };
}

function testHost(handlers: Record<string, (input: Record<string, unknown>) => CapabilityResult | Promise<CapabilityResult>>): CapabilityHost {
  const registry = new CapabilityRegistry();
  for (const [id, invoke] of Object.entries(handlers)) {
    registry.register({
      descriptor: () => ({
        id,
        description: id,
        inputSchema: {},
        outputSchema: {},
        sideEffect: id.startsWith('desktop.') ? 'write' : 'read',
        requiredService: 'test',
        providerKind: 'local',
        timeoutMs: 1_000,
        untrustedOutput: id.startsWith('research.'),
      }),
      availability: async () => ({ id, availability: 'up', degraded: false }),
      invoke: async input => invoke(input),
    });
  }
  return registry;
}

test('capability invoker uses CapabilityHost and never invents shell', async () => {
  const calls: string[] = [];
  const host = testHost({
    'system.status': input => {
      calls.push(JSON.stringify(input));
      return result('system.status', { content: 'cpu ok' });
    },
  });
  const agent = new WorkAgent({
    invoke: createCapabilityWorkInvoker({ host }),
  });
  const task = agent.receive('Read system status', planForObjective('Read system status', 'system.status'));
  const done = await agent.run(task.id);
  assert.equal(done.status, 'COMPLETED');
  assert.equal(done.outcome, 'success');
  assert.ok(done.toolResults.some(item => item.capability === 'system.status' && item.status === 'ok'));
  assert.equal(isBlockedCapabilityId('shell.exec'), true);
  const blocked = await createCapabilityWorkInvoker({ host })(done, {
    ...done.plan[0],
    kind: 'apply',
    capability: 'shell.exec',
    status: 'pending',
  }, new AbortController().signal);
  assert.equal(blocked.errorCode, 'CAPABILITY_DENIED');
});

test('capability invoker maps confirmation_required to permission wait', async () => {
  const host = testHost({
    'desktop.openTrustedUrl': () => result('desktop.openTrustedUrl', {
      status: 'confirmation_required',
      content: '',
      error: 'Allow once required',
      sideEffect: 'write',
    }),
  });
  const agent = new WorkAgent({
    invoke: createCapabilityWorkInvoker({ host }),
  });
  const understand: PlanStep = {
    id: 'understand_test1',
    title: 'Understand',
    kind: 'understand',
    dependencies: [],
    status: 'pending',
    riskLevel: 'LOW',
    verificationMethod: 'observation',
    retryPolicy: { maxAttempts: 1, attempted: 0 },
  };
  const apply: PlanStep = {
    id: 'apply_test1',
    title: 'Open url',
    kind: 'apply',
    dependencies: [understand.id],
    status: 'pending',
    capability: 'desktop.openTrustedUrl',
    riskLevel: 'MEDIUM',
    verificationMethod: 'observation',
    retryPolicy: { maxAttempts: 1, attempted: 0 },
    input: { url: 'https://example.com' },
  };
  const task = agent.receive('Open a trusted url', [understand, apply]);
  const paused = await agent.run(task.id);
  assert.equal(paused.status, 'WAITING_PERMISSION');
  assert.equal(paused.plan.find(item => item.id === apply.id)?.status, 'waiting_permission');
});

test('sqlite work store survives restart without replaying done steps', async () => {
  const root = tempRoot('jarvis-work-');
  const dbPath = path.join(root, 'work.db');
  const store = new WorkTaskStore({ dbPath });
  let applyCalls = 0;
  const agent = new WorkAgent({
    store,
    invoke: async (_task: WorkTask, step: PlanStep) => {
      if (step.kind === 'apply' || step.capability === 'system.status') applyCalls += 1;
      return { ok: true, summary: `${step.kind} ok`, toolResult: step.capability ? { capability: step.capability, status: 'ok', summary: 'ok' } : undefined };
    },
  });
  const task = agent.receive('Read system status', planForObjective('Read system status', 'system.status'));
  const done = await agent.run(task.id);
  assert.equal(done.status, 'COMPLETED');
  const firstCalls = applyCalls;
  store.close();

  const restored = new WorkTaskStore({ dbPath });
  assert.equal(restored.get(task.id)?.status, 'COMPLETED');
  assert.ok(restored.get(task.id)?.plan.every(step => step.status === 'done' || step.status === 'skipped'));
  const again = new WorkAgent({
    store: restored,
    invoke: async () => {
      applyCalls += 1;
      return { ok: true, summary: 'should not run' };
    },
  });
  const replay = await again.run(task.id);
  assert.equal(replay.status, 'COMPLETED');
  assert.equal(applyCalls, firstCalls);
  restored.close();
});

test('interrupted mutating apply is not retried after restart', () => {
  const root = tempRoot('jarvis-work-int-');
  const dbPath = path.join(root, 'work.db');
  const store = new WorkTaskStore({ dbPath });
  const task = store.create({
    objective: 'mutate',
    plan: [{
      id: 'apply_mut',
      title: 'Write',
      kind: 'apply',
      dependencies: [],
      status: 'running',
      riskLevel: 'MEDIUM',
      verificationMethod: 'observation',
      retryPolicy: { maxAttempts: 2, attempted: 1 },
    }],
  });
  store.save({ ...task, status: 'EXECUTING' });
  store.close();
  const restored = new WorkTaskStore({ dbPath });
  assert.equal(restored.get(task.id)?.plan[0]?.status, 'failed');
  restored.close();
});

test('evolution lifecycle records experience and refuses trusted skills from failure', () => {
  const experiences = new ExperienceStore();
  const reflections = new ReflectionLedger();
  const failures = new FailureLedger();
  const skills = new SkillVersionRegistry();
  const selfModel = new CapabilitySelfModel();
  const failed: WorkTask = {
    id: 'task_deadbeefdead',
    objective: 'Fetch driver notes',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'FAILED',
    outcome: 'failure',
    plan: [],
    evidence: [],
    toolResults: [{ capability: 'research.fetchSource', status: 'timeout', summary: 'timeout' }],
    permissionRequirements: [],
    retryBudget: 1,
    retriesUsed: 1,
    errors: [{ at: new Date().toISOString(), code: 'RESEARCH_TIMEOUT', message: 'timeout' }],
  };
  const result = applyTaskOutcome(failed, { experiences, reflections, failures, skills, selfModel });
  assert.ok(result.experience);
  assert.equal(result.reflection?.skillCandidateAllowed, false);
  assert.equal(skills.list().length, 0);
  assert.ok(failures.list().length >= 1);
});

test('evolution sqlite store reloads experiences, reflections, and self-model', () => {
  const root = tempRoot('jarvis-evo-');
  const persist = new EvolutionPersistence(path.join(root, 'evolution.db'));
  const experiences = new ExperienceStore(() => 1_000, persist.experiences);
  experiences.create({
    kind: 'episodic',
    domain: 'task',
    goal: 'status',
    situation: 'status',
    actions: ['apply'],
    tools: ['system.status'],
    result: 'ok',
    outcome: 'success',
    lessons: ['reuse status'],
    confidence: 0.8,
    privacyClass: 'private',
    significance: 0.7,
  });
  persist.close();
  const again = new EvolutionPersistence(path.join(root, 'evolution.db'));
  const reloaded = new ExperienceStore(() => 2_000, again.experiences);
  assert.equal(reloaded.list().length, 1);
  assert.equal(reloaded.list()[0]?.goal, 'status');
  again.close();
});

test('night cycle persists reflections and proposes only success skill candidates', () => {
  const experiences = new ExperienceStore();
  const skills = new SkillVersionRegistry();
  const reflections = new ReflectionLedger();
  const success = experiences.create({
    kind: 'episodic',
    domain: 'task',
    goal: 'status',
    situation: 'status',
    actions: ['apply'],
    tools: ['system.status'],
    result: 'ok',
    outcome: 'success',
    lessons: ['ok'],
    confidence: 0.9,
    privacyClass: 'private',
    significance: 0.8,
  });
  const failed = experiences.create({
    kind: 'episodic',
    domain: 'research',
    goal: 'fetch',
    situation: 'timeout',
    actions: ['research'],
    tools: ['research.fetchSource'],
    result: 'timeout',
    outcome: 'failure',
    lessons: [],
    confidence: 0.4,
    privacyClass: 'private',
    significance: 0.8,
    cause: 'RESEARCH_TIMEOUT',
  });
  const night = new NightCycle({ experiences, skills, reflections, failures: new FailureLedger() });
  const report = night.run();
  assert.equal(report.status, 'completed');
  assert.ok(report.reflectionsCreated >= 1);
  assert.ok(skills.list().some(item => item.evidence.includes(success.id) && item.status === 'CANDIDATE'));
  assert.ok(!skills.list().some(item => item.evidence.includes(failed.id)));
  const failureReflection = reflectStructured(failed, [], 'important_failure');
  assert.equal(failureReflection.skillCandidateAllowed, false);
});

test('command center runObjective invokes a real host capability', async () => {
  const host = testHost({
    'system.status': () => result('system.status', { content: 'ram ok' }),
  });
  const center = new CommandCenterRuntime({
    host,
    persistRoot: tempRoot('jarvis-cc-'),
  });
  const task = await center.runObjective('Read system status');
  assert.equal(task.status, 'COMPLETED');
  assert.equal(task.simulated, undefined);
  assert.ok(task.toolResults.some(item => item.capability === 'system.status'));
  assert.ok(center.experiences.list().length >= 1);
  center.agent.store.close();
  center.persistence?.close();
});

test('HTTP objective and night parsers stay fail-closed', () => {
  assert.equal(parseObjective(''), undefined);
  assert.equal(parseObjective('../etc/passwd'), undefined);
  assert.ok(parseObjective('Read system status'));
  assert.equal(parseNightAction('explode'), undefined);
  assert.equal(parseNightAction('run'), 'run');
});

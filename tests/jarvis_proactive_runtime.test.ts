import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommandCenterRuntime,
  EXISTING_SCHEDULERS,
  ExperienceStore,
  NIGHT_STAGES,
  NIGHT_V2_PIPELINE,
  NightCycle,
  PROACTIVE_COORDINATOR,
  PROACTIVE_JOB_STATES,
  PROACTIVE_NOTICE_POLICY,
  ProactiveMonitor,
  ProactiveRuntime,
  auditSchedulers,
  evaluatePreemption,
  evaluateProactiveNotice,
  gpuHighLoadNotice,
  inQuietHours,
  mapNightStageToV2,
  monitorDedupKey,
  presentCommandCenter,
  proactiveRuntimeIsScheduler,
  recoverInterruptedTask,
  RESOURCE_PRIORITY_ORDER,
  RESOURCE_PRIORITY_RANK,
  shouldYieldBackground,
  workTaskJobState,
  yieldsTo,
} from '../src/jarvis';
import { newStepId } from '../src/jarvis/agent/store';
import type { PlanStep, WorkTask } from '../src/jarvis/agent/types';
import type { ResourcePriority } from '../src/jarvis/ops/types';

function experienceStore(): ExperienceStore {
  const experiences = new ExperienceStore();
  experiences.create({
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
  return experiences;
}

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

test('resource priority is five levels and background yields to all higher work', () => {
  assert.deepEqual([...RESOURCE_PRIORITY_ORDER], [
    'realtime_voice',
    'owner_task',
    'scheduled_action',
    'monitoring',
    'background_evolution',
  ]);
  assert.ok(RESOURCE_PRIORITY_RANK.realtime_voice > RESOURCE_PRIORITY_RANK.owner_task);
  assert.ok(RESOURCE_PRIORITY_RANK.owner_task > RESOURCE_PRIORITY_RANK.scheduled_action);
  assert.ok(RESOURCE_PRIORITY_RANK.scheduled_action > RESOURCE_PRIORITY_RANK.monitoring);
  assert.ok(RESOURCE_PRIORITY_RANK.monitoring > RESOURCE_PRIORITY_RANK.background_evolution);
  assert.equal(yieldsTo('background_evolution', 'realtime_voice'), true);
  assert.equal(yieldsTo('background_evolution', 'monitoring'), true);
  assert.equal(yieldsTo('monitoring', 'owner_task'), true);
  assert.equal(yieldsTo('realtime_voice', 'monitoring'), false);
  assert.equal(shouldYieldBackground('scheduled_action'), true);
  assert.equal(shouldYieldBackground('background_evolution'), false);
  assert.equal(evaluatePreemption('background_evolution', 'owner_task').yieldRunning, true);
  assert.equal(evaluatePreemption('realtime_voice', 'owner_task').yieldRunning, false);
});

test('proactive GPU notice suggests without killing processes or auto-acting', () => {
  const notice = gpuHighLoadNotice();
  assert.equal(notice.summary, 'GPU load has remained unusually high');
  assert.equal(notice.notify, true);
  assert.equal(notice.suggest, true);
  assert.equal(notice.autoAct, false);
  assert.equal(notice.killProcesses, false);
  assert.equal(notice.physicalAct, false);
  assert.equal(PROACTIVE_NOTICE_POLICY.mayAutoAct, false);
  assert.equal(PROACTIVE_NOTICE_POLICY.mayKillProcesses, false);
  assert.equal(evaluateProactiveNotice('disk filling').autoAct, false);
});

test('quiet hours, cooldown, dedup, suppress, importance, and owner acknowledgement', () => {
  let now = Date.parse('2026-08-19T23:30:00.000Z');
  const monitor = new ProactiveMonitor({
    quietHours: { startHour: 23, endHour: 7 },
    minSeverity: 'warning',
    minImportance: 'low',
    cooldownMs: 60_000,
  }, () => now);
  const signal = {
    id: 'gpu',
    type: 'temperature' as const,
    summary: 'GPU load has remained unusually high',
    severity: 'warning' as const,
    importance: 'high' as const,
    at: new Date(now).toISOString(),
    ownerRelevant: true,
    simulated: true,
  };
  assert.equal(inQuietHours({ quietHours: { startHour: 23, endHour: 7 }, minSeverity: 'warning', cooldownMs: 1 }, 23), true);
  assert.equal(monitor.ingest(signal), 'aggregate');

  now = Date.parse('2026-08-20T08:00:00.000Z');
  assert.equal(monitor.ingest(signal), 'notify');
  assert.equal(monitor.ingest(signal), 'ignore');
  now += 61_000;
  assert.equal(monitor.ingest(signal), 'notify');

  monitor.acknowledge(signal);
  assert.equal(monitor.ingest(signal), 'ignore');
  now += 61_000;
  assert.equal(monitor.ingest(signal), 'notify');

  const key = monitorDedupKey(signal);
  monitor.suppress(key);
  now += 61_000;
  assert.equal(monitor.ingest(signal), 'ignore');
  monitor.unsuppress(key);
  assert.equal(monitor.ingest(signal), 'notify');

  const strict = new ProactiveMonitor({
    quietHours: null,
    minSeverity: 'info',
    minImportance: 'high',
    cooldownMs: 1,
  }, () => now);
  assert.equal(strict.ingest({ ...signal, importance: 'normal' }), 'ignore');
  assert.equal(strict.ingest({ ...signal, importance: 'high' }), 'notify');
});

test('night yields to higher priority, resumes the same stage, and never auto-promotes', () => {
  const experiences = experienceStore();
  let priority: ResourcePriority = 'scheduled_action';
  const night = new NightCycle({
    experiences,
    resource: () => priority,
    simulated: true,
  });
  const yielded = night.run();
  assert.equal(yielded.status, 'yielded');
  assert.equal(yielded.stage, 'DIGEST');
  assert.equal(yielded.v2Stage, 'maintenance');
  assert.equal(yielded.pauseReason, 'yielded');
  assert.equal(yielded.autoPromoted, false);
  assert.deepEqual([...yielded.v2Pipeline], [...NIGHT_V2_PIPELINE]);
  assert.equal(mapNightStageToV2('BENCHMARK'), 'benchmark');
  assert.equal(mapNightStageToV2('DISTILL_SKILLS'), 'skill_review');
  assert.equal(NIGHT_STAGES.length > 0, true);

  priority = 'background_evolution';
  night.resume();
  const done = night.run();
  assert.equal(done.status, 'completed');
  assert.equal(done.v2Stage, 'report');
  assert.equal(done.experiencesProcessed, 1);
  assert.equal(done.autoPromoted, false);
});

test('night budget pause stays paused, not yielded', () => {
  const experiences = experienceStore();
  let t = 0;
  const night = new NightCycle({
    experiences,
    budgets: { nightCycleRuntimeMs: 1 },
    now: () => {
      t += 10;
      return t;
    },
    simulated: true,
  });
  const paused = night.run();
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pauseReason, 'budget');
  assert.equal(paused.autoPromoted, false);
});

test('owner foreground task yields night and permission wait does not auto-grant', async () => {
  const center = new CommandCenterRuntime({
    simulated: true,
    invoke: async (_task, planStep) => {
      if (planStep.kind === 'permission' || planStep.capability === 'workspace.getDocument') {
        return { ok: false, permissionRequired: true, summary: 'Need owner allow', errorCode: 'PERMISSION_REQUIRED' };
      }
      return { ok: true, summary: 'ok' };
    },
  });
  const understand = step('understand');
  const permission = step('permission', [understand.id], { capability: 'workspace.getDocument' });
  const apply = step('apply', [permission.id]);
  const task = center.agent.receive('needs permission', [understand, permission, apply], { simulated: true });
  const waiting = await center.agent.run(task.id);
  assert.equal(waiting.status, 'WAITING_PERMISSION');
  assert.equal(workTaskJobState(waiting.status), 'waiting');
  assert.equal(center.currentResourcePriority(), 'owner_task');
  const yielded = center.runNight();
  assert.equal(yielded.status, 'yielded');
  assert.equal(yielded.pausedFor, 'owner_task');
  assert.equal(center.agent.store.get(task.id)?.status, 'WAITING_PERMISSION');
  assert.equal(center.snapshot().permission.waiting, true);
  const presented = presentCommandCenter(center.snapshot());
  assert.equal(presented.proactive.jobs.some(job => job.kind === 'owner_task' && job.state === 'waiting'), true);
  assert.equal(presented.evolution.night.status, 'yielded');
  assert.equal(presented.proactive.autoPromoted, false);
});

test('mutating apply is not blindly retried after uncertain interruption', () => {
  const task: WorkTask = {
    id: 'task_mut',
    objective: 'mutate',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    status: 'EXECUTING',
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
    evidence: [],
    toolResults: [],
    permissionRequirements: [],
    retryBudget: 2,
    retriesUsed: 1,
    errors: [],
  };
  const recovered = recoverInterruptedTask(task);
  assert.equal(recovered.plan[0]?.status, 'failed');
  assert.match(recovered.plan[0]?.resultSummary || '', /not automatically retried/);

  const safe: WorkTask = {
    ...task,
    id: 'task_read',
    plan: [{
      ...task.plan[0]!,
      id: 'search_1',
      kind: 'search',
      riskLevel: 'LOW',
      status: 'running',
    }],
  };
  const pending = recoverInterruptedTask(safe);
  assert.equal(pending.plan[0]?.status, 'pending');
});

test('no fourth scheduler and coordinator is not a scheduler', () => {
  const audit = auditSchedulers();
  assert.equal(audit.competingSchedulerAdded, false);
  assert.equal(audit.coordinatorIsScheduler, false);
  assert.equal(proactiveRuntimeIsScheduler(), false);
  assert.equal(PROACTIVE_COORDINATOR.isScheduler, false);
  assert.equal(EXISTING_SCHEDULERS.length, 3);
  assert.deepEqual(EXISTING_SCHEDULERS.map(item => item.id), [
    'reminders',
    'night_cycle',
    'proactive_monitor',
  ]);
  const runtime = new ProactiveRuntime({
    reminders: () => ({ nextRunAt: '2026-08-20T18:00:00.000Z', activeCount: 1, pendingCount: 0 }),
    simulated: true,
  });
  const snap = runtime.snapshot();
  assert.equal(snap.schedulerCount, 3);
  assert.equal(snap.competingSchedulerAdded, false);
  assert.equal(snap.coordinatorIsScheduler, false);
  assert.equal(snap.autoPromoted, false);
  assert.equal(snap.jobs[0]?.kind, 'reminder');
  assert.equal(snap.jobs[0]?.priority, 'scheduled_action');
  assert.equal('chainOfThought' in snap, false);
  assert.equal('thoughts' in snap, false);
  assert.equal('hiddenReasoning' in snap, false);
  assert.deepEqual([...PROACTIVE_JOB_STATES], [
    'scheduled',
    'running',
    'paused',
    'yielded',
    'waiting',
    'completed',
  ]);
});

test('Command Center exposes scheduled running paused yielded waiting completed without hidden reasoning', () => {
  const idle = new CommandCenterRuntime({ simulated: true });
  const presented = presentCommandCenter(idle.snapshot());
  assert.equal(presented.proactive.simulated, true);
  assert.equal(presented.proactive.label, 'SIMULATION');
  assert.equal(presented.proactive.currentPriority, 'background_evolution');
  assert.equal(presented.proactive.noticePolicy.mayAutoAct, false);
  assert.equal(presented.proactive.noticePolicy.mayKillProcesses, false);
  assert.equal(presented.proactive.schedulerCount, 3);
  assert.equal(presented.evolution.night.autoPromoted, false);
  assert.ok(presented.proactive.jobs.some(job => job.kind === 'night' && job.state === 'scheduled'));
  assert.ok(presented.proactive.jobs.some(job => job.kind === 'monitor' && job.state === 'scheduled'));
  const completed = idle.runNight();
  assert.equal(completed.status, 'completed');
  assert.equal(completed.autoPromoted, false);
  const after = presentCommandCenter(idle.snapshot());
  assert.equal(after.evolution.night.status, 'completed');
  assert.equal(after.proactive.jobs.find(job => job.kind === 'night')?.state, 'completed');
  assert.equal('chainOfThought' in after.proactive, false);
});

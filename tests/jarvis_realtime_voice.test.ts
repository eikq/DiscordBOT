import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CommandCenterRuntime,
  GAM_PERSONA_ID,
  GAM_VOICE_ID,
  INTERRUPTION_KINDS,
  JARVIS_PERSONA_ID,
  JARVIS_VOICE_ID,
  MockSttPort,
  MockTtsPort,
  PlaybackClock,
  VOICE_TURN_STATES,
  VoiceInteractionRuntime,
  WorkAgent,
  assertIndependentPersonaVoice,
  canTransitionVoiceTurn,
  classifyInterruption,
  decideBargeIn,
  decideStreaming,
  defaultIndependentProfiles,
  higherResourcePriority,
  isMutatingWork,
  resourcePriorityForVoice,
  shouldRunEstimateTimer,
  syncPresenterPlayback,
  transitionVoiceTurn,
  visualStateForVoiceTurn,
  workIsWaitingOwner,
} from '../src/jarvis';
import { newStepId } from '../src/jarvis/agent/store';
import type { PlanStep, WorkTask } from '../src/jarvis/agent/types';
import { createPlayback } from '../src/jarvis/presentation/briefing/playback';
import type { NarrationSegment, PresentationModel } from '../src/jarvis/presentation/briefing/types';

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

function briefingModel(): PresentationModel {
  const segments: NarrationSegment[] = [
    {
      id: 'n1',
      order: 0,
      text: 'First',
      kind: 'summary',
      target: { type: 'section', id: 's1' },
      estimatedMs: 1000,
    },
    {
      id: 'n2',
      order: 1,
      text: 'Second',
      kind: 'finish',
      target: { type: 'section', id: 's2' },
      estimatedMs: 1000,
    },
  ];
  return {
    id: 'pres-realtime',
    title: 'Realtime briefing',
    mode: 'summary',
    density: 'rich',
    summary: 'First then second',
    spokenSummary: 'First then second',
    sections: [{ id: 's1', title: 'Summary', kind: 'summary', body: 'First' }],
    cards: [],
    evidence: [],
    limitations: [],
    recommendedActions: [],
    followUpSuggestions: [],
    narrationSegments: segments,
    motionTimeline: [],
    playback: createPlayback('pres-realtime', segments, { playbackState: 'playing' }),
  };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) throw new Error(`timeout waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('voice turn states are explicit and illegal transitions fail closed', () => {
  assert.deepEqual([...VOICE_TURN_STATES], [
    'IDLE',
    'LISTENING',
    'TRANSCRIBING',
    'THINKING',
    'WORKING',
    'SPEAKING',
    'INTERRUPTED',
    'WAITING_OWNER',
    'ERROR',
  ]);
  assert.equal(canTransitionVoiceTurn('IDLE', 'LISTENING'), true);
  assert.equal(canTransitionVoiceTurn('SPEAKING', 'INTERRUPTED'), true);
  assert.equal(canTransitionVoiceTurn('SPEAKING', 'THINKING'), false);
  assert.throws(() => transitionVoiceTurn('SPEAKING', 'THINKING'), (error: Error & { reasonCode?: string }) => {
    assert.equal(error.reasonCode, 'PLAN_INVALID');
    return true;
  });
  assert.equal(visualStateForVoiceTurn('WAITING_OWNER'), 'WAITING_PERMISSION');
  assert.equal(visualStateForVoiceTurn('INTERRUPTED'), 'LISTENING');
});

test('STT mock lifecycle listen → transcribe → done without persisting audio', async () => {
  const stt = new MockSttPort();
  const voice = new VoiceInteractionRuntime({ stt });
  assert.equal(voice.snapshot().state, 'IDLE');
  const listening = voice.listen();
  assert.equal(listening.state, 'LISTENING');
  assert.equal(stt.status(), 'listening');
  const transcribed = await voice.transcribe('hello');
  assert.equal(transcribed.state, 'TRANSCRIBING');
  assert.equal(transcribed.transcript, 'hello');
  assert.equal(stt.status(), 'done');
  assert.ok(stt.events.includes(`transcribing:${listening.turnId}`));
  assert.equal('persist' in stt, false);
});

test('STT provider unavailable fails closed to ERROR', async () => {
  const stt = new MockSttPort({ available: false });
  const voice = new VoiceInteractionRuntime({ stt });
  const listening = voice.listen();
  assert.equal(listening.state, 'ERROR');
  assert.equal(listening.provider, 'stt');
  assert.match(listening.error || '', /unavailable/i);
  const again = await voice.transcribe('hello');
  assert.equal(again.state, 'ERROR');
});

test('TTS mock lifecycle speak → cancel → resume, and unavailable fails closed', async () => {
  const tts = new MockTtsPort({ defer: true });
  const voice = new VoiceInteractionRuntime({ tts });
  voice.listen();
  await voice.transcribe('hello');
  voice.think('hello');
  const pending = voice.speak('a longer spoken answer');
  await waitFor(() => tts.status() === 'speaking', 'tts speaking');
  assert.equal(voice.snapshot().state, 'SPEAKING');
  assert.equal(voice.resourcePriority(), 'realtime_voice');
  const cancelled = await voice.cancelSpeak();
  assert.equal(cancelled.state, 'INTERRUPTED');
  assert.equal(tts.status(), 'cancelled');
  const spoken = await pending;
  assert.equal(spoken.spoken?.status, 'cancelled');
  const resumed = await voice.resumeSpeak();
  assert.equal(resumed.spoken?.status, 'spoken');
  assert.equal(voice.snapshot().state, 'IDLE');
  assert.ok(tts.events.some(event => event.startsWith('resume:')));

  const down = new VoiceInteractionRuntime({ tts: new MockTtsPort({ available: false }) });
  down.listen();
  await down.transcribe('hello');
  down.think('hello');
  const failed = await down.speak('cannot speak');
  assert.equal(failed.state, 'ERROR');
  assert.equal(failed.provider, 'tts');
});

test('barge-in while speaking classifies stop, question, correction, and new command', async () => {
  assert.equal(classifyInterruption('stop'), 'stop');
  assert.equal(classifyInterruption('what is that?'), 'question');
  assert.equal(classifyInterruption('ไม่ใช่ แก้เป็น Jarvis'), 'correction');
  assert.equal(classifyInterruption('actually I meant no'), 'correction');
  assert.equal(classifyInterruption('inspect these files'), 'new_command');
  assert.deepEqual([...INTERRUPTION_KINDS], ['question', 'correction', 'stop', 'new_command', 'unknown']);

  const tts = new MockTtsPort({ defer: true });
  const voice = new VoiceInteractionRuntime({ tts });
  voice.listen();
  await voice.transcribe('hello');
  voice.think('hello');
  const pending = voice.speak('I am still talking');
  await waitFor(() => tts.status() === 'speaking', 'tts speaking');
  const barge = await voice.bargeIn('stop');
  assert.equal(barge.interruptionKind, 'stop');
  assert.equal(barge.bargeIn?.cancelPlayback, true);
  assert.equal(barge.bargeIn?.preserveTask, true);
  assert.equal(barge.state, 'LISTENING');
  const finished = await pending;
  assert.equal(finished.spoken?.status, 'cancelled');
});

test('streaming conversation may present early; agentic work cannot claim success', async () => {
  const conversation = decideStreaming({ route: 'CONVERSATION', agentic: false });
  assert.equal(conversation.mayBeginPresentation, true);
  assert.equal(conversation.claimSuccess, false);

  const running = decideStreaming({ route: 'WORK', agentic: true, workStatus: 'EXECUTING' });
  assert.equal(running.mayBeginPresentation, false);
  assert.equal(running.claimSuccess, false);

  const complete = decideStreaming({
    route: 'WORK',
    agentic: true,
    workStatus: 'COMPLETED',
    outcome: 'success',
    verificationPassed: true,
  });
  assert.equal(complete.mayBeginPresentation, true);
  assert.equal(complete.claimSuccess, true);

  const turn = await new VoiceInteractionRuntime().runTurn('hello');
  assert.equal(turn.spoken?.status, 'spoken');
  assert.equal(turn.streaming?.claimSuccess, false);
  assert.equal(turn.state, 'IDLE');

  const work = await new VoiceInteractionRuntime().runTurn('inspect these files');
  assert.equal(work.state, 'WORKING');
  assert.equal(work.route?.agentic, true);
  assert.equal(work.streaming?.claimSuccess, false);
  assert.equal(work.spoken, undefined);
});

test('Presenter playback clock is the only timeline; estimate is ignored while speaking', () => {
  const clock = new PlaybackClock();
  clock.bootstrapEstimate(250);
  assert.equal(clock.snapshot().source, 'bootstrap_estimate');
  assert.equal(clock.elapsedMs(), 250);
  assert.equal(shouldRunEstimateTimer(false), true);

  clock.startSpeech();
  clock.bootstrapEstimate(9999);
  assert.equal(clock.snapshot().source, 'speech');
  assert.equal(clock.elapsedMs(), 0);
  clock.setSpeechElapsed(1500);
  assert.equal(clock.elapsedMs(), 1500);
  assert.equal(shouldRunEstimateTimer(true), false);

  const synced = syncPresenterPlayback(briefingModel(), clock);
  assert.equal(synced.playback.spokenAtMs, 1500);
  assert.equal(synced.playback.segmentIndex, 1);
  assert.equal(synced.playback.playbackState, 'playing');

  clock.cancel();
  const cancelled = syncPresenterPlayback({
    ...synced,
    playback: { ...synced.playback, playbackState: 'cancelled' },
  }, clock);
  assert.equal(cancelled.playback.playbackState, 'cancelled');
});

test('resource priority is realtime voice over owner task over background evolution', () => {
  assert.equal(resourcePriorityForVoice('IDLE'), 'background_evolution');
  assert.equal(resourcePriorityForVoice('LISTENING'), 'realtime_voice');
  assert.equal(resourcePriorityForVoice('SPEAKING'), 'realtime_voice');
  assert.equal(resourcePriorityForVoice('THINKING'), 'owner_task');
  assert.equal(resourcePriorityForVoice('WORKING'), 'owner_task');
  assert.equal(higherResourcePriority('realtime_voice', 'owner_task'), 'realtime_voice');
  assert.equal(higherResourcePriority('owner_task', 'background_evolution'), 'owner_task');
});

test('persona and voice stay independent; style is not capability authority', () => {
  const voice = new VoiceInteractionRuntime();
  assert.deepEqual(voice.profiles(), defaultIndependentProfiles());
  voice.selectVoice(GAM_VOICE_ID);
  assert.equal(voice.profiles().personaProfileId, JARVIS_PERSONA_ID);
  assert.equal(voice.profiles().voiceProfileId, GAM_VOICE_ID);
  voice.selectPersona(GAM_PERSONA_ID);
  assert.equal(voice.profiles().voiceProfileId, GAM_VOICE_ID);
  const check = assertIndependentPersonaVoice({
    personaProfileId: GAM_PERSONA_ID,
    voiceProfileId: GAM_VOICE_ID,
    previousVoiceProfileId: GAM_VOICE_ID,
    changed: 'persona',
  });
  assert.equal(check.voiceUnchangedByPersona, true);
  assert.equal(check.authorityUnchanged, true);
});

test('owner interruption during mutating WorkAgent cancels playback only', async () => {
  let applyStarted = false;
  const agent = new WorkAgent({
    simulated: true,
    invoke: async (_task, planStep, signal) => {
      if (planStep.kind !== 'apply') return { ok: true, summary: 'ok' };
      applyStarted = true;
      await new Promise<void>((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('Cancelled.'), { reasonCode: 'CANCELLED' }));
        });
      });
      return { ok: true, summary: 'should not finish' };
    },
  });
  const understand = step('understand');
  const apply = step('apply', [understand.id], { riskLevel: 'HIGH' });
  const task = agent.receive('mutate a system setting', [understand, apply]);
  const running = agent.run(task.id);
  await waitFor(() => applyStarted, 'mutating apply');
  const live = agent.store.get(task.id)!;
  assert.equal(isMutatingWork(live), true);

  const tts = new MockTtsPort({ defer: true });
  const voice = new VoiceInteractionRuntime({ agent, tts });
  voice.listen();
  await voice.transcribe('hello');
  voice.think('hello');
  const pending = voice.speak('applying the change now');
  await waitFor(() => tts.status() === 'speaking', 'tts speaking');
  const barge = await voice.bargeIn('stop', agent.store.get(task.id));
  assert.equal(barge.bargeIn?.mutatingWork, true);
  assert.equal(barge.bargeIn?.workAction, 'none');
  assert.equal(barge.bargeIn?.preserveTask, true);
  const after = agent.store.get(task.id)!;
  assert.notEqual(after.status, 'PAUSED');
  assert.notEqual(after.status, 'CANCELLED');
  await pending;
  const cancelled = agent.cancel(task.id);
  assert.equal(cancelled.status, 'CANCELLED');
  const done = await running;
  assert.equal(done.status, 'CANCELLED');
});

test('non-mutating stop may pause WorkAgent without cancelling mutating policy', async () => {
  const agent = new WorkAgent({ simulated: true });
  const understand = step('understand');
  const apply = step('apply', [understand.id], { riskLevel: 'LOW' });
  const task = agent.receive('summarize notes', [understand, apply]);
  agent.store.setStatus(task.id, 'PLANNING');
  agent.store.setStatus(task.id, 'READY');
  const ready = agent.store.get(task.id)!;
  assert.equal(isMutatingWork(ready), false);
  const decision = decideBargeIn({ kind: 'stop', speaking: true, task: ready });
  assert.equal(decision.workAction, 'pause');
  assert.equal(decision.mutatingWork, false);

  const voice = new VoiceInteractionRuntime({ agent });
  voice.listen();
  await voice.transcribe('hello');
  voice.think('hello');
  await voice.speak('working');
  const barge = await voice.bargeIn('stop', agent.store.get(task.id));
  assert.equal(barge.bargeIn?.workAction, 'pause');
  assert.equal(agent.store.get(task.id)?.status, 'PAUSED');
});

test('permission wait maps to WAITING_OWNER and preserves the task', async () => {
  const agent = new WorkAgent({
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
  const task = agent.receive('needs permission', [understand, permission, apply]);
  const waiting = await agent.run(task.id);
  assert.equal(waiting.status, 'WAITING_PERMISSION');
  assert.equal(workIsWaitingOwner(waiting), true);

  const tts = new MockTtsPort({ defer: true });
  const voice = new VoiceInteractionRuntime({ agent, tts });
  voice.listen();
  await voice.transcribe('hello');
  voice.think('hello');
  const pending = voice.speak('I need your OK');
  await waitFor(() => tts.status() === 'speaking', 'tts speaking');
  const barge = await voice.bargeIn('what is that?', waiting);
  assert.equal(barge.state, 'WAITING_OWNER');
  assert.equal(barge.bargeIn?.workAction, 'none');
  assert.equal(agent.store.get(task.id)?.status, 'WAITING_PERMISSION');
  await pending;
  voice.waitingOwner(agent.store.get(task.id));
  assert.equal(voice.grantAndContinue().state, 'WORKING');
  assert.equal(agent.store.get(task.id)?.status, 'WAITING_PERMISSION');
});

test('Command Center night pauses for realtime voice and still completes when idle', () => {
  const idle = new CommandCenterRuntime({ simulated: true });
  assert.equal(idle.voice.resourcePriority(), 'background_evolution');
  assert.equal(idle.runNight().status, 'completed');

  const busy = new CommandCenterRuntime({ simulated: true });
  busy.voice.listen();
  assert.equal(busy.voice.resourcePriority(), 'realtime_voice');
  const paused = busy.runNight();
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pausedFor, 'realtime_voice');
});

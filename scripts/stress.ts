import { SocialBrain } from '../src/bot/brain/SocialBrain';
import { GroupConversationState } from '../src/bot/brain/GroupConversationState';
import { ConversationTimeline } from '../src/bot/timeline/ConversationTimeline';
import { ResponseGenerator } from '../src/bot/personality/ResponseGenerator';
import assert from 'node:assert/strict';

export async function runStressSimulation() {
  console.log('=== DIGITAL ME PHASE 6 STRESS & BARGE-IN SIMULATION ===\n');

  // Keep this verification deterministic even when a developer has a live
  // local model running. Live-model classification is covered separately.
  process.env.LLM_ENABLED = 'false';
  const brain = new SocialBrain('Spin');
  const generator = new ResponseGenerator();
  const turns = [
    { speaker: 'Anu', text: 'มึงจะเล่น valo ปะ', expectedAction: 'IGNORE' },
    { speaker: 'Bank', text: 'อย่าเลยแม่งกาก', expectedAction: 'IGNORE' },
    { speaker: 'Tan', text: '555', expectedAction: 'IGNORE' },
    { speaker: 'Anu', text: 'Spin ว่าไง', expectedAction: 'ANSWER' },
    { speaker: 'Bank', text: 'เดี๋ยวๆๆๆ มีคนมา', expectedAction: 'IGNORE' },
    { speaker: 'Bank', text: 'งั้นเล่น minecraft', expectedAction: 'IGNORE' },
    { speaker: 'Anu', text: 'เอาปะ Spin', expectedAction: 'ANSWER' }
  ];

  const timeline = new ConversationTimeline();
  timeline.addEvent({
    type: 'VOICE_SESSION_STARTED',
    sessionId: 'stress_1',
    guildId: 'guild_1',
    channelId: 'channel_1',
    timestamp: Date.now()
  });

  let totalTurnsProcessed = 0;
  let interruptionsTriggered = 0;

  for (const turn of turns) {
    console.log(`▶ [Turn ${totalTurnsProcessed + 1}] ${turn.speaker}: "${turn.text}"`);

    timeline.addEvent({
      type: 'TRANSCRIPT_FINAL',
      eventId: Math.random().toString(36).substring(7),
      sessionId: 'stress_1',
      discordUserId: turn.speaker,
      username: turn.speaker,
      displayName: turn.speaker,
      rawText: turn.text,
      confidence: 0.99,
      timestamp: Date.now(),
      speechStartedAt: Date.now() - 500,
      speechEndedAt: Date.now(),
      sttLatencyMs: 50
    });

    const state = new GroupConversationState(timeline);
    const decision = await brain.evaluate(state);
    assert.equal(decision.action, turn.expectedAction, `Unexpected action for turn: ${turn.text}`);

    if (decision.action !== 'IGNORE') {
      const response = await generator.generate(decision, state);
      console.log(`   -> Social Decision: ${decision.action} (${decision.reasonCode}) | Response: "${response}"`);
    } else {
      console.log(`   -> Social Decision: IGNORE (${decision.reasonCode}) | (Silent)`);
    }

    if (turn.text.includes('เดี๋ยวๆๆๆ')) {
      interruptionsTriggered++;
      console.log(`   ⚡ Simulated interruption marker reached (live playback cancellation is covered by npm test).`);
    }

    totalTurnsProcessed++;
  }

  console.log(`\n=== STRESS SIMULATION SUMMARY ===`);
  console.log(`Processed Turns: ${totalTurnsProcessed}`);
  console.log(`Simulated Interruption Markers: ${interruptionsTriggered}`);
  console.log(`Decision Loop: VERIFIED\n`);
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('stress')) {
  runStressSimulation().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

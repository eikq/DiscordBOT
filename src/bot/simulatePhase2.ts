import fs from 'fs';
import path from 'path';
import { SocialBrain } from './brain/SocialBrain';
import { GroupConversationState } from './brain/GroupConversationState';
import { ConversationTimeline } from './timeline/ConversationTimeline';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

async function runSimulation() {
  console.log("=== PHASE 2: SOCIAL BRAIN SIMULATOR (ZERO-COST LOCAL) ===\n");

  const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'thai_social_cases.jsonl');
  const cases = fs.readFileSync(fixturesPath, 'utf-8').trim().split('\n').map(line => JSON.parse(line));

  // Fixture verification must not change when a developer happens to have a
  // local LLM online. Live-model behavior is evaluated separately.
  process.env.LLM_ENABLED = 'false';
  const brain = new SocialBrain("Spin");

  let passed = 0;
  let total = cases.length;

  for (const testCase of cases) {
    const timeline = new ConversationTimeline();
    timeline.addEvent({
      type: 'VOICE_SESSION_STARTED',
      sessionId: 'sim_2',
      guildId: 'guild_1',
      channelId: 'channel_1',
      timestamp: Date.now()
    });

    for (const [index, ctxLine] of testCase.context.entries()) {
      const isLegacyString = typeof ctxLine === 'string';
      const parts = isLegacyString ? ctxLine.split(': ') : [];
      const speaker = isLegacyString ? (parts[0] || 'Unknown') : (ctxLine.speaker || 'Unknown');
      const text = isLegacyString ? (parts.slice(1).join(': ') || ctxLine) : ctxLine.text;
      const timestamp = isLegacyString ? Date.now() + index : (ctxLine.timestamp ?? Date.now() + index);

      timeline.addEvent({
        type: 'TRANSCRIPT_FINAL',
        eventId: Math.random().toString(36).substring(7),
        sessionId: 'sim_2',
        discordUserId: speaker,
        username: speaker,
        displayName: speaker,
        rawText: text,
        confidence: 0.99,
        timestamp,
        speechStartedAt: timestamp - 500,
        speechEndedAt: timestamp,
        sttLatencyMs: 100
      });
    }

    const state = new GroupConversationState(timeline);
    const decision = await brain.evaluate(state);
    
    const isPass = decision.action === testCase.expectedAction || 
                   (testCase.expectedAction === 'ANSWER' && decision.action === 'SHORT_REACTION') ||
                   (testCase.expectedAction === 'SHORT_REACTION' && decision.action === 'ANSWER');

    if (isPass) passed++;
    
    const lastInput = testCase.context[testCase.context.length - 1];
    const lastInputText = typeof lastInput === 'string' ? lastInput : `${lastInput.speaker}: ${lastInput.text}`;
    console.log(`[Case #${testCase.id}] Input: "${lastInputText}" -> Expected: ${testCase.expectedAction} | Got: ${decision.action} (${isPass ? '✅ PASS' : '❌ FAIL'})`);
  }

  console.log(`\n=== ACCURACY SCORE: ${passed} / ${total} (${Math.round((passed / total) * 100)}%) ===\n`);
  if (passed !== total) {
    throw new Error(`Phase 2 simulation failed: ${total - passed} case(s) did not match expectations.`);
  }
}

runSimulation().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

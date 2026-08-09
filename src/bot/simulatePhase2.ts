import fs from 'fs';
import path from 'path';
import { SocialBrain } from './brain/SocialBrain';
import { GroupConversationState } from './brain/GroupConversationState';
import { ConversationTimeline } from './timeline/ConversationTimeline';
import dotenv from 'dotenv';

dotenv.config();

async function runSimulation() {
  console.log("=== PHASE 2: SOCIAL BRAIN SIMULATOR (ZERO-COST LOCAL) ===\n");

  const fixturesPath = path.join(process.cwd(), 'tests', 'fixtures', 'thai_social_cases.jsonl');
  const cases = fs.readFileSync(fixturesPath, 'utf-8').trim().split('\n').map(line => JSON.parse(line));

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

    for (const ctxLine of testCase.context) {
      const parts = ctxLine.split(': ');
      const speaker = parts[0] || 'Unknown';
      const text = parts.slice(1).join(': ') || ctxLine;

      timeline.addEvent({
        type: 'TRANSCRIPT_FINAL',
        eventId: Math.random().toString(36).substring(7),
        sessionId: 'sim_2',
        discordUserId: speaker,
        username: speaker,
        displayName: speaker,
        rawText: text,
        confidence: 0.99,
        timestamp: Date.now(),
        speechStartedAt: Date.now() - 500,
        speechEndedAt: Date.now(),
        sttLatencyMs: 100
      });
    }

    const state = new GroupConversationState(timeline);
    const decision = await brain.evaluate(state);
    
    const isPass = decision.action === testCase.expectedAction || 
                   (testCase.expectedAction === 'ANSWER' && decision.action === 'SHORT_REACTION') ||
                   (testCase.expectedAction === 'SHORT_REACTION' && decision.action === 'ANSWER');

    if (isPass) passed++;
    
    console.log(`[Case #${testCase.id}] Input: "${testCase.context[testCase.context.length - 1]}" -> Expected: ${testCase.expectedAction} | Got: ${decision.action} (${isPass ? '✅ PASS' : '❌ FAIL'})`);
  }

  console.log(`\n=== ACCURACY SCORE: ${passed} / ${total} (${Math.round((passed / total) * 100)}%) ===\n`);
}

runSimulation().catch(console.error);

import fs from 'fs';
import path from 'path';
import { ResponseGenerator } from '../src/bot/personality/ResponseGenerator';
import { GroupConversationState } from '../src/bot/brain/GroupConversationState';
import { ConversationTimeline } from '../src/bot/timeline/ConversationTimeline';

export async function runOfflineEvaluator() {
  console.log('=== DIGITAL ME PERSONALITY EVALUATOR ===\n');

  const dataPath = path.join(process.cwd(), 'data', 'behavior', 'examples.json');
  if (!fs.existsSync(dataPath)) {
    console.log('No behavior dataset found at data/behavior/examples.json');
    return;
  }

  const examples = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  const generator = new ResponseGenerator();

  let evaluated = 0;
  let matches = 0;

  for (const ex of examples) {
    if (ex.ownerAction === 'IGNORE') continue;

    const timeline = new ConversationTimeline();
    timeline.addEvent({
      type: 'VOICE_SESSION_STARTED',
      sessionId: 'eval_1',
      guildId: 'guild_1',
      channelId: 'channel_1',
      timestamp: Date.now()
    });

    for (const msg of ex.context) {
      timeline.addEvent({
        type: 'TRANSCRIPT_FINAL',
        eventId: Math.random().toString(36).substring(7),
        sessionId: 'eval_1',
        discordUserId: msg.speaker,
        username: msg.speaker,
        displayName: msg.speaker,
        rawText: msg.text,
        confidence: 0.99,
        timestamp: Date.now(),
        speechStartedAt: Date.now() - 500,
        speechEndedAt: Date.now(),
        sttLatencyMs: 100
      });
    }

    const state = new GroupConversationState(timeline);
    const decision = {
      action: ex.ownerAction as any,
      targetUserIds: [ex.context[0]?.speaker || 'Friend'],
      confidence: 0.9,
      directlyAddressed: ex.directlyAddressed,
      responseExpected: 0.8,
      interruptAppropriate: false,
      desiredLength: 'very_short' as const,
      tone: 'casual',
      reasonCode: 'EVAL'
    };

    const aiResponse = await generator.generate(decision, state);
    evaluated++;

    console.log(`Context: "${ex.context[0]?.speaker}: ${ex.context[0]?.text}"`);
    console.log(`  -> Real Owner Response: "${ex.ownerResponse}"`);
    console.log(`  -> AI Twin Generated:   "${aiResponse}"`);

    if (aiResponse && ex.ownerResponse && (aiResponse.includes(ex.ownerResponse) || ex.ownerResponse.includes(aiResponse))) {
      matches++;
      console.log(`  -> Score: MATCH\n`);
    } else {
      console.log(`  -> Score: MISMATCH\n`);
    }
  }

  const matchRate = evaluated > 0 ? Math.round((matches / evaluated) * 100) : 0;
  console.log(`=== EVALUATION RESULTS: ${matches}/${evaluated} matched (${matchRate}%) ===\n`);
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('evaluate')) {
  runOfflineEvaluator().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

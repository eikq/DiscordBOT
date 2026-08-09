import { SocialBrain } from './brain/SocialBrain';
import { GroupConversationState } from './brain/GroupConversationState';
import { ConversationTimeline } from './timeline/ConversationTimeline';
import { ResponseGenerator } from './personality/ResponseGenerator';
import dotenv from 'dotenv';
import assert from 'node:assert/strict';

dotenv.config({ quiet: true });

async function runSimulation() {
    console.log("=== PHASE 3: PERSONALITY & BEHAVIOR SIMULATOR ===\n");

    process.env.LLM_ENABLED = 'false';
    const brain = new SocialBrain("Spin");
    const generator = new ResponseGenerator();

    const scenarios = [
        {
            name: "Direct question about gaming",
            context: [
                { speaker: "Anu", text: "Spin มึงจะเล่น valo ปะ", timestamp: 1000 }
            ],
            expectedAction: 'ANSWER'
        },
        {
            name: "Asking for opinion",
            context: [
                { speaker: "Anu", text: "เกมนี้มันแปลกๆว่ะ", timestamp: 1000 },
                { speaker: "Bank", text: "Spin มึงว่าไง", timestamp: 2000 }
            ],
            expectedAction: 'ANSWER'
        },
        {
            name: "Banter (should ignore)",
            context: [
                { speaker: "Anu", text: "ไอ้ Bank แม่งกาก", timestamp: 1000 },
                { speaker: "Bank", text: "มึงก็กาก", timestamp: 2000 }
            ],
            expectedAction: 'IGNORE'
        }
    ];

    for (const scenario of scenarios) {
        console.log(`\n▶ Scenario: ${scenario.name}`);
        
        const timeline = new ConversationTimeline();
        timeline.addEvent({
            type: 'VOICE_SESSION_STARTED',
            sessionId: 'sim_3',
            guildId: 'guild_1',
            channelId: 'channel_1',
            timestamp: Date.now()
        });

        for (const msg of scenario.context) {
            console.log(`  ${msg.speaker}: "${msg.text}"`);
            timeline.addEvent({
                type: 'TRANSCRIPT_FINAL',
                eventId: Math.random().toString(36).substring(7),
                sessionId: 'sim_3',
                discordUserId: msg.speaker,
                username: msg.speaker,
                displayName: msg.speaker,
                rawText: msg.text,
                confidence: 0.99,
                timestamp: msg.timestamp,
                speechStartedAt: msg.timestamp - 500,
                speechEndedAt: msg.timestamp,
                sttLatencyMs: 100
            });
        }

        const state = new GroupConversationState(timeline);
        
        console.log("  -- Evaluating Social Brain --");
        const decision = await brain.evaluate(state);
        assert.equal(decision.action, scenario.expectedAction, `${scenario.name}: unexpected social action`);
        
        if (decision.action !== 'IGNORE') {
            console.log("  -- Generating Response --");
            const response = await generator.generate(decision, state);
            console.log(`\n  ✅ Digital Me (Spin): "${response}"\n`);
        } else {
            console.log(`\n  ✅ Digital Me (Spin): [NO RESPONSE] (Action: ${decision.action})\n`);
        }
    }
}

runSimulation().catch(error => {
    console.error(error);
    process.exitCode = 1;
});

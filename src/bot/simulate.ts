import { ConversationTimeline } from './timeline/ConversationTimeline';

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function simulate() {
    console.log("=== THAI REAL-TIME DISCORD VOICE SIMULATOR ===");
    console.log("Starting simulation...\n");

    const timeline = new ConversationTimeline();
    const sessionId = "sim_1";

    timeline.addEvent({
        type: 'VOICE_SESSION_STARTED',
        sessionId,
        guildId: 'guild_1',
        channelId: 'channel_1',
        timestamp: Date.now()
    });

    const spin = { id: '1', name: 'Spin' };
    const anu = { id: '2', name: 'Anu' };
    const bank = { id: '3', name: 'Bank' };

    // Spin: "โย"
    timeline.addEvent({ type: 'SPEECH_STARTED', eventId: 'e1', sessionId, discordUserId: spin.id, username: spin.name, displayName: spin.name, timestamp: Date.now() });
    await sleep(300);
    timeline.addEvent({ type: 'TRANSCRIPT_PARTIAL', eventId: 'e1', sessionId, discordUserId: spin.id, username: spin.name, displayName: spin.name, rawText: 'โย', confidence: 0.9, timestamp: Date.now(), speechStartedAt: Date.now() - 300 });
    timeline.addEvent({ type: 'TRANSCRIPT_FINAL', eventId: 'e1', sessionId, discordUserId: spin.id, username: spin.name, displayName: spin.name, rawText: 'โย', confidence: 0.95, timestamp: Date.now(), speechStartedAt: Date.now() - 300, speechEndedAt: Date.now(), sttLatencyMs: 50 });
    timeline.addEvent({ type: 'SPEECH_ENDED', eventId: 'e1', sessionId, discordUserId: spin.id, username: spin.name, displayName: spin.name, timestamp: Date.now() });

    await sleep(1000);

    // Anu: "มึงเล่น valo ปะ"
    timeline.addEvent({ type: 'SPEECH_STARTED', eventId: 'e2', sessionId, discordUserId: anu.id, username: anu.name, displayName: anu.name, timestamp: Date.now() });
    await sleep(500);
    timeline.addEvent({ type: 'TRANSCRIPT_PARTIAL', eventId: 'e2', sessionId, discordUserId: anu.id, username: anu.name, displayName: anu.name, rawText: 'มึงเล่น', confidence: 0.8, timestamp: Date.now(), speechStartedAt: Date.now() - 500 });
    await sleep(500);
    timeline.addEvent({ type: 'TRANSCRIPT_PARTIAL', eventId: 'e2', sessionId, discordUserId: anu.id, username: anu.name, displayName: anu.name, rawText: 'มึงเล่น valo', confidence: 0.8, timestamp: Date.now(), speechStartedAt: Date.now() - 1000 });
    await sleep(300);
    
    // Bank interrupts while Anu is finishing
    timeline.addEvent({ type: 'SPEECH_STARTED', eventId: 'e3', sessionId, discordUserId: bank.id, username: bank.name, displayName: bank.name, timestamp: Date.now() });
    timeline.addEvent({ type: 'TRANSCRIPT_FINAL', eventId: 'e2', sessionId, discordUserId: anu.id, username: anu.name, displayName: anu.name, rawText: 'มึงเล่น valo ปะ', confidence: 0.92, timestamp: Date.now(), speechStartedAt: Date.now() - 1300, speechEndedAt: Date.now(), sttLatencyMs: 120 });
    timeline.addEvent({ type: 'SPEECH_ENDED', eventId: 'e2', sessionId, discordUserId: anu.id, username: anu.name, displayName: anu.name, timestamp: Date.now() });

    // Bank: "ไม่เอา"
    await sleep(200);
    timeline.addEvent({ type: 'TRANSCRIPT_PARTIAL', eventId: 'e3', sessionId, discordUserId: bank.id, username: bank.name, displayName: bank.name, rawText: 'ไม่เอา', confidence: 0.9, timestamp: Date.now(), speechStartedAt: Date.now() - 200 });
    timeline.addEvent({ type: 'TRANSCRIPT_FINAL', eventId: 'e3', sessionId, discordUserId: bank.id, username: bank.name, displayName: bank.name, rawText: 'ไม่เอา', confidence: 0.98, timestamp: Date.now(), speechStartedAt: Date.now() - 200, speechEndedAt: Date.now(), sttLatencyMs: 40 });
    timeline.addEvent({ type: 'SPEECH_ENDED', eventId: 'e3', sessionId, discordUserId: bank.id, username: bank.name, displayName: bank.name, timestamp: Date.now() });

    await sleep(800);

    // Spin: "งั้น minecraft?"
    timeline.addEvent({ type: 'SPEECH_STARTED', eventId: 'e4', sessionId, discordUserId: spin.id, username: spin.name, displayName: spin.name, timestamp: Date.now() });
    await sleep(400);
    timeline.addEvent({ type: 'TRANSCRIPT_PARTIAL', eventId: 'e4', sessionId, discordUserId: spin.id, username: spin.name, displayName: spin.name, rawText: 'งั้น', confidence: 0.7, timestamp: Date.now(), speechStartedAt: Date.now() - 400 });
    await sleep(400);
    timeline.addEvent({ type: 'TRANSCRIPT_FINAL', eventId: 'e4', sessionId, discordUserId: spin.id, username: spin.name, displayName: spin.name, rawText: 'งั้น minecraft?', confidence: 0.91, timestamp: Date.now(), speechStartedAt: Date.now() - 800, speechEndedAt: Date.now(), sttLatencyMs: 80 });
    timeline.addEvent({ type: 'SPEECH_ENDED', eventId: 'e4', sessionId, discordUserId: spin.id, username: spin.name, displayName: spin.name, timestamp: Date.now() });

    console.log("\nSimulation Complete.");
    const snap = timeline.getConversationSnapshot();
    console.log("\nSnapshot:\n", snap.recentTranscripts.join('\n'));
}

simulate().catch(console.error);

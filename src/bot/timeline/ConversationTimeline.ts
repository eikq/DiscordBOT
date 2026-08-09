import { ConversationEvent, TranscriptFinalEvent } from '../types/events';

export class ConversationTimeline {
    private events: ConversationEvent[] = [];

    public addEvent(event: ConversationEvent) {
        this.events.push(event);
        // We can keep it bounded or persist to disk later.
        
        // Console output for simulation/debug
        if (event.type === 'SPEECH_STARTED') {
            console.log(`[${this.formatTime(event.timestamp)}] SPEECH_START ${event.displayName}`);
        } else if (event.type === 'TRANSCRIPT_PARTIAL') {
            console.log(`[${this.formatTime(event.timestamp)}] PARTIAL ${event.displayName}:\n"${event.rawText}"`);
        } else if (event.type === 'TRANSCRIPT_FINAL') {
            console.log(`[${this.formatTime(event.timestamp)}] FINAL ${event.displayName}:\n"${event.rawText}"`);
        } else if (event.type === 'BOT_RESPONSE') {
            console.log(`[${this.formatTime(event.timestamp)}] BOT_RESPONSE Digital Me:\n"${event.text}"`);
        } else if (event.type === 'SPEECH_ENDED') {
            console.log(`[${this.formatTime(event.timestamp)}] SPEECH_END ${event.displayName}`);
        } else if (event.type === 'STT_ERROR') {
            console.error(`[${this.formatTime(event.timestamp)}] STT_ERROR: ${event.error}`);
        }
    }

    public getRecentEvents(limit: number = 50): ConversationEvent[] {
        return this.events.slice(-limit);
    }

    public getRecentFinalTranscripts(limit: number = 20): TranscriptFinalEvent[] {
        return this.events
            .filter((e): e is TranscriptFinalEvent => e.type === 'TRANSCRIPT_FINAL')
            .slice(-limit);
    }

    public getSpeakerHistory(userId: string): TranscriptFinalEvent[] {
        return this.events
            .filter((e): e is TranscriptFinalEvent => e.type === 'TRANSCRIPT_FINAL' && e.discordUserId === userId);
    }

    public getConversationSnapshot() {
        return {
            totalEvents: this.events.length,
            recentTranscripts: this.getRecentFinalTranscripts(10).map(t => `${t.displayName}: ${t.rawText}`)
        };
    }
    
    public clear() {
        this.events = [];
    }

    private formatTime(timestamp: number): string {
        const d = new Date(timestamp);
        return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
    }
}

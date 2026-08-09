import { ConversationTimeline } from '../timeline/ConversationTimeline';
import { TranscriptFinalEvent } from '../types/events';

export interface FormattedContext {
    participants: string[];
    recentTranscripts: string[];
}

export class GroupConversationState {
    private timeline: ConversationTimeline;

    constructor(timeline: ConversationTimeline) {
        this.timeline = timeline;
    }

    public getContext(limit: number = 20): FormattedContext {
        const transcripts = this.timeline.getRecentFinalTranscripts(limit);
        
        const participantsSet = new Set<string>();
        const recentTranscripts: string[] = [];

        for (const t of transcripts) {
            participantsSet.add(t.displayName);
            
            const time = new Date(t.timestamp);
            const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;
            
            recentTranscripts.push(`[${timeStr}] ${t.displayName}: "${t.rawText}"`);
        }

        return {
            participants: Array.from(participantsSet),
            recentTranscripts
        };
    }
}

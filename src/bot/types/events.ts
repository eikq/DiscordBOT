export type ConversationEvent = 
    | VoiceSessionStartedEvent
    | VoiceSessionEndedEvent
    | SpeakerJoinedEvent
    | SpeakerLeftEvent
    | SpeechStartedEvent
    | TranscriptPartialEvent
    | TranscriptFinalEvent
    | NonSpeechEvent
    | SpeechEndedEvent
    | STTErrorEvent
    | VoiceErrorEvent
    | BotResponseEvent
    | BotSpeechCancelledEvent;

export interface BotSpeechCancelledEvent {
    type: 'BOT_SPEECH_CANCELLED';
    sessionId: string;
    timestamp: number;
}

export interface BotResponseEvent {
    type: 'BOT_RESPONSE';
    sessionId: string;
    discordUserId: string;
    text: string;
    timestamp: number;
}

export interface VoiceSessionStartedEvent {
    type: 'VOICE_SESSION_STARTED';
    sessionId: string;
    guildId: string;
    channelId: string;
    timestamp: number;
}

export interface VoiceSessionEndedEvent {
    type: 'VOICE_SESSION_ENDED';
    sessionId: string;
    timestamp: number;
}

export interface SpeakerJoinedEvent {
    type: 'SPEAKER_JOINED';
    sessionId: string;
    discordUserId: string;
    username: string;
    displayName: string;
    timestamp: number;
}

export interface SpeakerLeftEvent {
    type: 'SPEAKER_LEFT';
    sessionId: string;
    discordUserId: string;
    timestamp: number;
}

export interface SpeechStartedEvent {
    type: 'SPEECH_STARTED';
    eventId: string;
    sessionId: string;
    discordUserId: string;
    username: string;
    displayName: string;
    timestamp: number;
}

export interface TranscriptPartialEvent {
    type: 'TRANSCRIPT_PARTIAL';
    eventId: string;
    sessionId: string;
    discordUserId: string;
    username: string;
    displayName: string;
    rawText: string;
    normalizedText?: string;
    confidence: number;
    timestamp: number;
    speechStartedAt: number;
}

export interface TranscriptFinalEvent {
    type: 'TRANSCRIPT_FINAL';
    eventId: string;
    sessionId: string;
    discordUserId: string;
    username: string;
    displayName: string;
    rawText: string;
    normalizedText?: string;
    confidence: number;
    timestamp: number;
    speechStartedAt: number;
    speechEndedAt: number;
    sttLatencyMs: number;
    detectedLanguage?: string;
    sttModel?: string;
    languageFallbackApplied?: boolean;
    verified?: boolean;
    verificationMethod?: string;
    speechConfidence?: number;
}

export interface NonSpeechEvent {
    type: 'NON_SPEECH';
    eventId: string;
    sessionId: string;
    discordUserId: string;
    username: string;
    displayName: string;
    subtype: 'NOISE' | 'SILENCE';
    displayText: string;
    durationMs: number;
    rmsDbfs?: number;
    reason?: string;
    rejectedText?: string;
    debugAudioPath?: string;
    timestamp: number;
}

export interface SpeechEndedEvent {
    type: 'SPEECH_ENDED';
    eventId: string;
    sessionId: string;
    discordUserId: string;
    username: string;
    displayName: string;
    timestamp: number;
}

export interface STTErrorEvent {
    type: 'STT_ERROR';
    sessionId: string;
    error: string;
    timestamp: number;
}

export interface VoiceErrorEvent {
    type: 'VOICE_ERROR';
    sessionId: string;
    error: string;
    timestamp: number;
}

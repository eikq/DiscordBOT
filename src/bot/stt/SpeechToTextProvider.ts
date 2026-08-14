import { EventEmitter } from 'events';
import { Readable } from 'stream';

export interface STTStreamOptions {
    userId: string;
    username: string;
    displayName: string;
    sessionId: string;
    codeSwitchLanguages?: string[];
}

export interface SpeechStreamEvents {
    'partial': (text: string, confidence: number) => void;
    'final': (text: string, confidence: number, latencyMs: number, metadata?: STTResultMetadata) => void;
    'nonSpeech': (metadata: STTNonSpeechMetadata) => void;
    'error': (error: Error) => void;
    'end': () => void;
}

export interface STTResultMetadata {
    detectedLanguage?: string;
    model?: string;
    languageFallbackApplied?: boolean;
    verified?: boolean;
    verificationMethod?: string;
    speechConfidence?: number;
}

export interface STTNonSpeechMetadata {
    subtype: 'NOISE' | 'SILENCE';
    displayText: string;
    durationMs: number;
    rmsDbfs?: number;
    reason?: string;
    rejectedText?: string;
    debugAudioPath?: string;
}

export declare interface SpeechStream {
    on<U extends keyof SpeechStreamEvents>(event: U, listener: SpeechStreamEvents[U]): this;
    emit<U extends keyof SpeechStreamEvents>(event: U, ...args: Parameters<SpeechStreamEvents[U]>): boolean;
}

export class SpeechStream extends EventEmitter {
    public write(pcmBuffer: Buffer) {
        // Implement in subclass
    }
    public discard(): void {
        // Drop callbacks for an utterance that must not reach STT or memory.
        this.removeAllListeners();
    }
    public async endStream(): Promise<void> {
        // Implement in subclass
        this.emit('end');
    }
}

export interface SpeechToTextProvider {
    createStream(options: STTStreamOptions): SpeechStream;
}

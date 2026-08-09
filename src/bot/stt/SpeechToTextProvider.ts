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
    'final': (text: string, confidence: number, latencyMs: number) => void;
    'error': (error: Error) => void;
    'end': () => void;
}

export declare interface SpeechStream {
    on<U extends keyof SpeechStreamEvents>(event: U, listener: SpeechStreamEvents[U]): this;
    emit<U extends keyof SpeechStreamEvents>(event: U, ...args: Parameters<SpeechStreamEvents[U]>): boolean;
}

export class SpeechStream extends EventEmitter {
    public write(pcmBuffer: Buffer) {
        // Implement in subclass
    }
    public endStream() {
        // Implement in subclass
        this.emit('end');
    }
}

export interface SpeechToTextProvider {
    createStream(options: STTStreamOptions): SpeechStream;
}

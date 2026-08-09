import { SpeechStream, SpeechToTextProvider, STTStreamOptions } from './SpeechToTextProvider';

export class MockSpeechStream extends SpeechStream {
    private isEnded = false;
    private timer: NodeJS.Timeout | null = null;
    
    // In a real STT, write(pcmBuffer) would pipe to an API.
    // Here we'll just ignore the buffer and let the simulator call emit directly if needed,
    // or simulate speech based on length of buffer received (mocking).
    private bytesReceived = 0;
    private options: STTStreamOptions;
    
    constructor(options: STTStreamOptions) {
        super();
        this.options = options;
    }

    public write(pcmBuffer: Buffer) {
        if (this.isEnded) return;
        this.bytesReceived += pcmBuffer.length;
        
        // Mock logic: every X bytes, emit a partial. 
        // This is heavily mocked just to allow testing real discord connections without an API.
        if (!this.timer) {
            this.timer = setTimeout(() => {
                this.emit('partial', 'Mock partial speech...', 0.5);
            }, 500);
        }
    }

    public endStream() {
        this.isEnded = true;
        if (this.timer) clearTimeout(this.timer);
        
        if (this.bytesReceived > 0) {
            this.emit('final', `Mock final speech from ${this.options.displayName} (bytes: ${this.bytesReceived})`, 0.9, 150);
        }
        
        this.emit('end');
    }
}

export class MockSTTProvider implements SpeechToTextProvider {
    createStream(options: STTStreamOptions): SpeechStream {
        return new MockSpeechStream(options);
    }
}

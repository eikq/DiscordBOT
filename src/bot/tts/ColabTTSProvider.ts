import { TTSProvider } from './TTSProvider';

export class ColabTTSProvider implements TTSProvider {
    private apiUrl: string;
    private activeSpeaker: string;

    constructor(apiUrl: string, activeSpeaker: string = "default") {
        this.apiUrl = apiUrl;
        this.activeSpeaker = activeSpeaker;
    }

    public setActiveSpeaker(speaker: string) {
        this.activeSpeaker = speaker;
    }

    async synthesize(text: string, speakerName?: string): Promise<Buffer | null> {
        if (!this.apiUrl) {
            console.error("[ColabTTS] Missing Colab API URL!");
            return null;
        }

        try {
            const targetSpeaker = speakerName || this.activeSpeaker || "default";
            console.log(`[ColabTTS] Sending text to Colab API: "${text}" (Speaker Voice: ${targetSpeaker})`);
            
            const response = await fetch(`${this.apiUrl.replace(/\/$/, '')}/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    text: text,
                    speaker: targetSpeaker,
                    voice: targetSpeaker 
                })
            });

            if (!response.ok) {
                console.error(`[ColabTTS] API Error: ${response.status} ${response.statusText}`);
                return null;
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            console.log(`[ColabTTS] Successfully generated audio from Colab (${buffer.length} bytes)`);
            return buffer;
        } catch (error) {
            console.error("[ColabTTS] Request to Colab failed:", error);
            return null;
        }
    }
}

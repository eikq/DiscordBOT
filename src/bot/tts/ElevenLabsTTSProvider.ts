import { TTSProvider } from './TTSProvider';

export class ElevenLabsTTSProvider implements TTSProvider {
    private apiKey: string;
    private voiceId: string;

    constructor(voiceId: string) {
        this.apiKey = process.env.ELEVENLABS_API_KEY || '';
        this.voiceId = voiceId; // The ID of the cloned voice
    }

    async synthesize(text: string): Promise<Buffer | null> {
        if (!this.apiKey) {
            console.error("[ElevenLabsTTS] Missing API Key! Set ELEVENLABS_API_KEY in .env");
            return null;
        }

        try {
            console.log(`[ElevenLabsTTS] Synthesizing: "${text}" with voice ${this.voiceId}`);
            
            const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
                method: 'POST',
                headers: {
                    'Accept': 'audio/mpeg',
                    'xi-api-key': this.apiKey,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text,
                    model_id: "eleven_multilingual_v2",
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                })
            });

            if (!response.ok) {
                console.error(`[ElevenLabsTTS] API Error: ${response.status} ${response.statusText}`);
                return null;
            }

            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            console.log(`[ElevenLabsTTS] Successfully generated audio (${buffer.length} bytes)`);
            return buffer;
        } catch (error) {
            console.error("[ElevenLabsTTS] Request failed:", error);
            return null;
        }
    }
}
